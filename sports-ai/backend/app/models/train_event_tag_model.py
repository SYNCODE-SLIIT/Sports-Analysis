#!/usr/bin/env python3
"""Train a simple text classifier for event tagging and save a joblib model.

Usage:
  python train_event_tag_model.py --input path/to/timeline_labeled.csv --output models/event_tag_model.pkl

If input CSV is missing, a tiny demo dataset will be used.
CSV must contain a text column (one of: description,text,event) and a label column named 'label'.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import joblib
import pandas as pd
import requests
import time

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report
import json
from pathlib import Path
from typing import Optional


def find_text_column(df: pd.DataFrame):
    for c in ("description", "text", "event", "body"):
        if c in df.columns:
            return c
    # fallback: any object column
    for c in df.columns:
        if df[c].dtype == object:
            return c
    return None


def load_dataset(path: Path):
    if not path.exists():
        return None
    df = pd.read_csv(path)
    return df


def small_demo_df():
    # tiny synthetic dataset for demonstration / smoke-run
    rows = [
        ("45' Header from corner", "GOAL"),
        ("Penalty scored by player", "PENALTY_GOAL"),
        ("Long range strike from outside the box", "GOAL"),
        ("Substitution: Player A ON for Player B", "SUBSTITUTION"),
        ("Yellow card for foul", "YELLOW_CARD"),
        ("Red card - straight red", "RED_CARD"),
    ]
    return pd.DataFrame(rows, columns=["description", "label"])


def _coarse_label(label: str) -> str:
    if not label: return label
    l = label.upper()
    # Goals and goal-like events
    if 'GOAL' in l or 'SCORE' in l or 'SCORED' in l or 'HEADER' in l or 'LONG_RANGE' in l:
        return 'GOAL'
    # Penalty goals
    if 'PENALTY' in l:
        return 'PENALTY_GOAL'
    # Explicit card types
    if 'YELLOW' in l:
        return 'YELLOW_CARD'
    if 'RED' in l:
        return 'RED_CARD'
    # Assist events
    if 'ASSIST' in l or 'ASSISTED' in l:
        return 'ASSIST'
    # Substitutions
    if 'SUBSTIT' in l or 'SUBSTITUTION' in l or 'ON FOR' in l:
        return 'SUBSTITUTION'
    return l


def _infer_label_from_text(text: str) -> Optional[str]:
    if not text:
        return None
    t = text.lower()
    # simple heuristics matching the augmentation rules in the agent
    if 'penalty' in t:
        return 'PENALTY_GOAL'
    if 'header' in t or 'headed' in t:
        return 'HEADER_GOAL'
    if 'yellow' in t:
        return 'YELLOW_CARD'
    if 'red' in t:
        return 'RED_CARD'
    if 'assist' in t or 'assisted' in t:
        return 'ASSIST'
    if 'substitut' in t or 'substitution' in t or 'on for' in t:
        return 'SUBSTITUTION'
    if 'goal' in t or 'scored' in t or "net" in t:
        return 'GOAL'
    # no confident label
    return None


def auto_build_from_cache(cache_dir: Path) -> pd.DataFrame:
    """Scan JSON cache files and extract timeline descriptions with weak labels.

    Returns a DataFrame with columns: description,label. May be empty if nothing found.
    """
    rows = []
    if not cache_dir.exists() or not cache_dir.is_dir():
        return pd.DataFrame(rows, columns=["description", "label"])

    # look for .json files in cache dir
    for p in sorted(cache_dir.glob('*.json')):
        try:
            with p.open('r', encoding='utf-8') as fh:
                j = json.load(fh)
        except Exception:
            continue

        # possible shapes: top-level timeline, result -> [ event -> timeline ], or event -> timeline
        candidates = []
        if isinstance(j, dict):
            # direct timeline list
            if isinstance(j.get('timeline'), list):
                candidates.extend(j.get('timeline'))
            # result array containing event objects
            res = j.get('result')
            if isinstance(res, list) and res:
                for ev in res:
                    if isinstance(ev, dict) and isinstance(ev.get('timeline'), list):
                        candidates.extend(ev.get('timeline'))
                    # sometimes timeline-like fields named 'events' or 'event_timeline'
                    for k in ('events','event_timeline','timeline_items'):
                        if isinstance(ev.get(k), list):
                            candidates.extend(ev.get(k))
            # event field
            if isinstance(j.get('event'), dict) and isinstance(j['event'].get('timeline'), list):
                candidates.extend(j['event'].get('timeline'))

        # flatten candidates and extract description-like fields
        for item in candidates:
            if not isinstance(item, dict):
                continue
            desc = item.get('description') or item.get('text') or item.get('event') or item.get('comment') or item.get('body') or ''
            desc = str(desc).strip()
            if not desc:
                continue
            label = _infer_label_from_text(desc)
            if label is None:
                # skip unlabeled examples for now
                continue
            rows.append((desc, label))

    if not rows:
        return pd.DataFrame(rows, columns=["description", "label"])
    return pd.DataFrame(rows, columns=["description", "label"])


def synth_event_timeline_from_resp(resp: dict) -> list:
    data = resp.get('data') or resp.get('result') or resp or {}
    timeline = []
    if isinstance(data, dict) and isinstance(data.get('result'), list) and data.get('result'):
        first = data['result'][0]
        if isinstance(first, dict) and isinstance(first.get('timeline'), list):
            timeline = first['timeline']
    if not timeline and isinstance(data, dict) and isinstance(data.get('timeline'), list):
        timeline = data.get('timeline')
    if not timeline and isinstance(resp.get('result'), list) and len(resp['result'])>0 and isinstance(resp['result'][0], dict) and isinstance(resp['result'][0].get('timeline'), list):
        timeline = resp['result'][0]['timeline']

    if not timeline and isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list):
                for item in v:
                    if isinstance(item, dict):
                        for k in ('timeline','events','event_timeline','timeline_items'):
                            if isinstance(item.get(k), list) and item.get(k):
                                timeline.extend(item.get(k))
                        if not timeline and item.get('scorers'):
                            for s in item.get('scorers'):
                                timeline.append({'minute': s.get('minute'), 'description': s.get('description') or s.get('text')})
                        # capture substitutions when present
                        if not timeline:
                            for sk in ('substitutes','substitutions','subs'):
                                sc = item.get(sk)
                                if isinstance(sc, list) and sc:
                                    for s in sc:
                                        if isinstance(s, dict):
                                            minute = s.get('minute') or s.get('time') or ''
                                            desc = s.get('description') or s.get('text') or ''
                                            player_in = s.get('player_in') or s.get('player_on') or s.get('on') or None
                                            player_out = s.get('player_out') or s.get('player_off') or s.get('off') or None
                                            row = {'minute': minute, 'description': desc or 'Substitution', 'raw': s}
                                            if player_in:
                                                row['player_in'] = player_in
                                            if player_out:
                                                row['player_out'] = player_out
                                            timeline.append(row)
                                        else:
                                            # try to parse simple string shapes
                                            txt = str(s)
                                            import re
                                            m = re.search(r"(?P<in>[^,]+?)\s+on\s+for\s+(?P<out>.+)", txt, flags=re.I)
                                            if not m:
                                                m = re.search(r"(?P<out>[^,]+?)\s+off\s+for\s+(?P<in>.+)", txt, flags=re.I)
                                            if m:
                                                player_in = (m.group('in') or '').strip()
                                                player_out = (m.group('out') or '').strip()
                                                timeline.append({'minute': '', 'description': txt, 'player_in': player_in, 'player_out': player_out})

    if not timeline and isinstance(data, dict):
        for k in ('scorers','scorers_home','home_scorers','goals','goals_home'):
            arr = data.get(k)
            if isinstance(arr, list) and arr:
                for s in arr:
                    if isinstance(s, dict):
                        timeline.append({'minute': s.get('minute') or s.get('time'), 'description': s.get('description') or s.get('text') or ''})

    out = []
    if not isinstance(timeline, list):
        return out
    for item in timeline:
        if isinstance(item, dict):
            desc = item.get('description') or item.get('text') or item.get('event') or item.get('comment') or ''
            minute = item.get('minute') or item.get('time') or ''
            if desc:
                out.append({'minute': minute, 'description': desc, 'raw': item})
    return out


def collect_and_weak_label(backend_base: str = 'http://127.0.0.1:8000', days: int = 30, out_unlabeled: Path | None = None, max_events: int = 1000, api_rate_limit_per_hour: int = 260) -> pd.DataFrame:
    """Call backend to collect fixtures/events, synthesize timeline rows, weak-label using heuristics.

    Returns a DataFrame with columns ['description','label'] or an empty DataFrame.
    Also writes an unlabeled CSV when out_unlabeled is provided.
    """
    # rate limiting: compute minimum interval between requests
    min_interval = 0.0
    if api_rate_limit_per_hour and api_rate_limit_per_hour > 0:
        min_interval = 3600.0 / float(api_rate_limit_per_hour)

    def _ensure_rate(last_time: float) -> float:
        """Ensure at least min_interval seconds have passed since last_time.
        Returns new timestamp after any sleep performed."""
        now = time.time()
        if min_interval > 0:
            elapsed = now - last_time
            to_wait = min_interval - elapsed
            if to_wait > 0:
                time.sleep(to_wait)
                return time.time()
        return now

    last_req = 0.0
    out_unlabeled = Path(out_unlabeled) if out_unlabeled else None
    rows = []
    # fixtures.list may reject ranges >15 days for some providers. Split into chunks <=15 days
    events = []
    try:
        end_date = pd.Timestamp.now().date()
        start_date = end_date - pd.Timedelta(days=days)
        cur = start_date
        max_span = pd.Timedelta(days=15)
        seen_ids = set()
        while cur <= end_date:
            chunk_end = min(cur + max_span - pd.Timedelta(days=1), end_date)
            payload = {"intent": "fixtures.list", "args": {"from": cur.isoformat(), "to": chunk_end.isoformat()}}
            try:
                last_req = _ensure_rate(last_req)
                r = requests.post(backend_base.rstrip('/') + '/collect', json=payload, timeout=20)
                r.raise_for_status()
                fixtures_resp = r.json()
            except Exception as e:
                # on chunk error, skip and continue
                print(f'fixtures.list chunk {cur.isoformat()}->{chunk_end.isoformat()} failed:', e)
                cur = chunk_end + pd.Timedelta(days=1)
                time.sleep(0.05)
                continue

            data = fixtures_resp.get('data') or fixtures_resp.get('result') or fixtures_resp
            chunk_events = []
            if isinstance(data, list):
                chunk_events = data
            elif isinstance(data, dict):
                for k in ('result','events','fixtures','data','results'):
                    if isinstance(data.get(k), list) and data.get(k):
                        chunk_events = data.get(k)
                        break
                if not chunk_events:
                    for v in data.values():
                        if isinstance(v, list):
                            chunk_events.extend(v)

            # deduplicate by common id fields
            for ev in chunk_events:
                ev_id = ev.get('event_key') or ev.get('idEvent') or ev.get('match_id') or ev.get('matchId') or ev.get('eventId')
                key = ev_id or json.dumps(ev, sort_keys=True)
                if key in seen_ids:
                    continue
                # try to synthesize timeline directly from the fixtures.list item to avoid an extra event.get
                synthesized = synth_event_timeline_from_resp({'data': ev})
                if synthesized:
                    # write rows directly from the chunk response
                    for t in synthesized:
                        if max_events and len(rows) >= max_events:
                            break
                        desc = t.get('description') or t.get('event') or t.get('text') or ''
                        if desc:
                            rows.append({'event_id': ev_id or '', 'minute': t.get('minute') or '', 'description': desc})
                    # mark as seen to avoid duplicate event.get later
                    seen_ids.add(key)
                    # if we've hit the row cap, break out of chunk processing
                    if max_events and len(rows) >= max_events:
                        break
                    # if we did synthesize, still keep the event in events list in case more info is needed
                    events.append(ev)
                    continue
                seen_ids.add(key)
                events.append(ev)

            cur = chunk_end + pd.Timedelta(days=1)
            time.sleep(0.03)
    except Exception as e:
        print('fixtures.list overall failed:', e)
        return pd.DataFrame([], columns=["description","label"])

    print(f'Collected fixtures/events count: {len(events)}')
    seen_rows = 0
    for ev in events:
        if max_events and seen_rows >= max_events:
            break
        ev_id = ev.get('event_key') or ev.get('idEvent') or ev.get('match_id') or ev.get('matchId') or ev.get('eventId')
        if not ev_id:
            continue
        try:
            payload = {"intent": "event.get", "args": {"eventId": ev_id}}
            last_req = _ensure_rate(last_req)
            r = requests.post(backend_base.rstrip('/') + '/collect', json=payload, timeout=15)
            r.raise_for_status()
            resp = r.json()
        except Exception:
            resp = {'ok': True, 'data': ev}
        timeline = synth_event_timeline_from_resp(resp)
        if not timeline:
            tl = []
            sc = ev.get('scorers') or ev.get('scorers_home') or ev.get('home_scorers')
            if isinstance(sc, list):
                for s in sc:
                    if isinstance(s, dict):
                        tl.append({'minute': s.get('minute'), 'description': s.get('description') or s.get('text')})
            timeline = tl

        for t in timeline:
            desc = t.get('description') or t.get('event') or t.get('text') or ''
            if desc:
                rows.append({'event_id': ev_id, 'minute': t.get('minute') or '', 'description': desc})
                seen_rows += 1
                if max_events and seen_rows >= max_events:
                    break
        time.sleep(0.02)

    # write unlabeled CSV if requested
    if out_unlabeled and rows:
        out_unlabeled.parent.mkdir(parents=True, exist_ok=True)
        import csv as _csv
        with open(out_unlabeled, 'w', newline='', encoding='utf-8') as fh:
            writer = _csv.DictWriter(fh, fieldnames=['event_id','minute','description'])
            writer.writeheader()
            for r in rows:
                writer.writerow(r)
        print(f'Wrote unlabeled rows: {len(rows)} -> {out_unlabeled}')

    # weak-label
    labeled = []
    for r in rows:
        label = _infer_label_from_text(r['description'])
        if label:
            labeled.append({'description': r['description'], 'label': label})

    if not labeled:
        return pd.DataFrame([], columns=["description","label"])
    return pd.DataFrame(labeled)


def train_and_save(df: pd.DataFrame, text_col: str, label_col: str, out_path: Path):
    X = df[text_col].fillna("").astype(str)
    y = df[label_col].astype(str)

    # Only stratify when every class has at least 2 samples
    stratify_arg = None
    try:
        vc = y.value_counts()
        if vc.min() >= 2:
            stratify_arg = y
    except Exception:
        stratify_arg = None

    # Protect against tiny datasets where stratified split would fail because
    # the test partition would need at least one sample per class. If the
    # computed test size (n_samples * 0.2) is smaller than the number of
    # distinct classes, disable stratification and warn.
    n_samples = len(X)
    n_classes = int(y.nunique()) if hasattr(y, 'nunique') else len(set(y))
    test_frac = 0.2
    test_n = max(1, int(n_samples * test_frac))
    if stratify_arg is not None and test_n < n_classes:
        print(f"Warning: dataset too small for stratified split (samples={n_samples}, classes={n_classes}, test_n={test_n}). Disabling stratify.")
        stratify_arg = None

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_frac, random_state=42, stratify=stratify_arg)

    # Use a logistic regression with balanced class weights to improve
    # performance on small/imbalanced label sets. Keep TF-IDF ngrams (1,2)
    # but limit features to avoid overfitting on tiny datasets.
    pipe = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1,2), max_features=5000, lowercase=True)),
        ("clf", LogisticRegression(class_weight='balanced', solver='liblinear', max_iter=1000, random_state=42)),
    ])

    pipe.fit(X_train, y_train)

    preds = pipe.predict(X_test)
    acc = accuracy_score(y_test, preds)
    print(f"Trained model. Test accuracy: {acc:.3f}")
    print(classification_report(y_test, preds, zero_division=0))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipe, out_path)
    print(f"Saved model to: {out_path}")

    # show a few sample predictions
    sample = X_test.sample(min(5, len(X_test)), random_state=1)
    print("Sample predictions:")
    for txt in sample:
        print("-", txt, "->", pipe.predict([txt])[0])


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--input", "-i", default="sports-ai/data/timeline_dataset_unlabeled.csv", help="Path to labeled CSV (columns: description,label)")
    p.add_argument("--output", "-o", default="models/event_tag_model.pkl", help="Output joblib model path")
    p.add_argument("--label-col", default="label", help="Label column name")
    p.add_argument("--text-col", default=None, help="Text column name (optional)")
    p.add_argument("--max-events", type=int, default=1000, help="Max timeline rows to collect during auto-collection")
    p.add_argument("--api-rate-limit", type=int, default=260, help="API request limit per hour for backend collect calls")
    args = p.parse_args(argv)

    inp = Path(args.input)
    out = Path(args.output)

    df = load_dataset(inp)
    # If no labeled CSV, try to auto-collect & weak-label from backend before falling back to demo
    if df is None or df.empty:
        print(f"Input file {inp} not found or empty — attempting auto-collection and weak-labeling from backend...")
        backend_base = os.environ.get('BACKEND_BASE', 'http://127.0.0.1:8000')
        out_unlabeled = Path(__file__).resolve().parents[3] / 'data' / 'timeline_dataset_unlabeled.csv'
        try:
            labeled_df = collect_and_weak_label(backend_base=backend_base, days=30, out_unlabeled=out_unlabeled, max_events=args.max_events)
            if labeled_df is not None and not labeled_df.empty:
                # map to coarse labels to increase support
                labeled_df['label'] = labeled_df['label'].astype(str).apply(_coarse_label)
                df = labeled_df
                print(f"Using weak-labeled dataset with {len(df)} rows (coarse labels).")
                # print counts per coarse label
                print('Label counts:')
                print(df['label'].value_counts())
            else:
                print("Auto-collection produced no labeled rows — falling back to small demo dataset.")
                df = small_demo_df()
        except Exception as e:
            print('Auto-collection failed:', e)
            df = small_demo_df()

    # map labels to coarse labels for more robust training
    if 'label' in df.columns:
        df['label'] = df['label'].astype(str).apply(_coarse_label)

    text_col = args.text_col or find_text_column(df)
    if not text_col:
        print("Could not detect a text column in the dataset. Provide --text-col.")
        sys.exit(1)
    if args.label_col not in df.columns:
        print(f"Label column '{args.label_col}' not found in dataset columns: {list(df.columns)}")
        sys.exit(1)

    train_and_save(df, text_col, args.label_col, out)


if __name__ == '__main__':
    main()

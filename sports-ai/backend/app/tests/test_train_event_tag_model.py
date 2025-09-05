import importlib.util
import pytest
try:
    import joblib
except Exception:
    joblib = None
from pathlib import Path
import pandas as pd


def _load_module_from_path(path: Path):
    spec = importlib.util.spec_from_file_location("train_event_tag_model", str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_train_and_print_tfidf_table(tmp_path):
    """Train using the small demo dataset, load the saved pipeline, and print a TF-IDF table and tags.

    This test is primarily demonstrative: it verifies the training call succeeds,
    that a model file is written, and it prints a small TF-IDF table (feature -> idf)
    and the list of labels the classifier produces.
    """
    # locate the train_event_tag_model.py relative to this test file
    module_path = Path(__file__).resolve().parents[1] / 'models' / 'train_event_tag_model.py'
    assert module_path.exists(), f"Module file not found at expected path: {module_path}"

    mod = _load_module_from_path(module_path)

    # get a tiny demo dataset from the module
    df = mod.small_demo_df()
    assert isinstance(df, pd.DataFrame) and not df.empty

    out_path = tmp_path / 'event_tag_model.pkl'

    # train and save model
    mod.train_and_save(df, text_col='description', label_col='label', out_path=out_path)
    assert out_path.exists(), "Model file was not written"

    # ensure joblib is available at test time
    if joblib is None:
        pytest.skip('joblib not available in test environment')

    # load the pipeline and inspect TF-IDF
    pipeline = joblib.load(out_path)
    assert hasattr(pipeline, 'named_steps') and 'tfidf' in pipeline.named_steps

    tfidf = pipeline.named_steps['tfidf']
    clf = pipeline.named_steps.get('clf')

    # obtain feature names with a safe fallback
    try:
        features = list(tfidf.get_feature_names_out())
    except Exception:
        # older sklearn versions
        features = sorted(tfidf.vocabulary_.keys(), key=lambda k: tfidf.vocabulary_[k])

    idf = getattr(tfidf, 'idf_', None)

    # build a small pandas table for display
    if idf is not None and len(idf) == len(features):
        feat_df = pd.DataFrame({'feature': features, 'idf': idf})
    else:
        feat_df = pd.DataFrame({'feature': features})

    # show the TF-IDF table (a few top rows) and the classifier tags
    print('\nTF-IDF feature -> idf (first 50 rows):')
    with pd.option_context('display.max_rows', 50, 'display.max_columns', 10):
        print(feat_df.sort_values(by='idf' if 'idf' in feat_df.columns else 'feature').reset_index(drop=True))

    if clf is not None and hasattr(clf, 'classes_'):
        print('\nClassifier tags (classes_):', list(clf.classes_))
    else:
        # some pipelines may expose classes directly
        classes = getattr(pipeline, 'classes_', None)
        print('\nClassifier tags (pipeline.classes_):', list(classes) if classes is not None else 'UNKNOWN')

    # basic sanity checks
    assert len(features) > 0, "No TF-IDF features were produced"
    # the predicted label for a sample text should be one of the known classes
    sample = df['description'].iloc[0]
    pred = pipeline.predict([sample])[0]
    if clf is not None and hasattr(clf, 'classes_'):
        assert pred in list(clf.classes_)

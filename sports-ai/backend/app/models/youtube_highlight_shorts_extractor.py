"""
YouTube Highlight Shorts Extractor
Extracts short clips from a YouTube highlight video by detecting special moments (audio spikes + scene changes).
Optimized for professional, scene-aligned shorts.
"""

import os
import numpy as np
import subprocess
from pytubefix import YouTube
import librosa
import shutil

# --- PARAMETERS ---
youtube_url = 'https://www.youtube.com/watch?v=II_-tx-G0Kw'  # Replace with your URL
output_dir = 'highlight_shorts'
os.makedirs(output_dir, exist_ok=True)
clip_duration = 30  # seconds per short
energy_threshold = 1.5  # Adjust for sensitivity
min_gap_seconds = 45  # Minimum gap between shorts (increase to reduce shorts)

# --- Download main video file if not present ---
video_path = os.path.join(output_dir, 'video.mp4')
if not os.path.exists(video_path):
    yt = YouTube(youtube_url)
    video_stream = yt.streams.filter(progressive=True, file_extension='mp4').order_by('resolution').desc().first()
    video_stream.download(output_path=output_dir, filename='video.mp4')
    print(f"✅ Main video downloaded: {video_path}")
else:
    print(f"✅ Main video already exists: {video_path}")

# --- Download audio only (fast, low data) ---
audio_path = os.path.join(output_dir, 'audio.mp4')
if not os.path.exists(audio_path):
    yt = YouTube(youtube_url)
    audio_stream = yt.streams.filter(only_audio=True).first()
    audio_stream.download(output_path=output_dir, filename='audio.mp4')
    print(f"✅ Audio downloaded: {audio_path}")
else:
    print(f"✅ Audio already exists: {audio_path}")

# --- Analyze audio for spikes (special moments) ---
print('Analyzing audio for special moments...')
y, sr = librosa.load(audio_path, sr=None)
frame_length = sr  # 1 second frames
hop_length = sr // 2
energy = np.array([
    np.sum(np.abs(y[i:i+frame_length]))
    for i in range(0, len(y), hop_length)
])
mean_energy = np.mean(energy)
special_indices = np.where(energy > energy_threshold * mean_energy)[0]
special_times = [int(i * hop_length / sr) for i in special_indices]
print(f'Found {len(special_times)} audio spikes.')

# --- Scene Change Detection (OpenCV required) ---
try:
    import cv2
    print('Detecting scene changes...')
    scene_changes = []
    cap = cv2.VideoCapture(video_path)
    prev_hist = None
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    scene_threshold = 0.6  # Higher = fewer scenes
    for i in range(frame_count):
        ret, frame = cap.read()
        if not ret:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        hist = cv2.calcHist([gray], [0], None, [256], [0,256])
        hist = cv2.normalize(hist, hist).flatten()
        if prev_hist is not None:
            diff = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA)
            if diff > scene_threshold:
                time_sec = i / fps
                scene_changes.append(time_sec)
        prev_hist = hist
    cap.release()
    print(f'Found {len(scene_changes)} scene changes.')
except ImportError:
    print('OpenCV not installed. Skipping scene change detection.')
    scene_changes = []

# --- Align moments to scene boundaries ---
def align_to_scene(moment, scene_changes):
    scene_changes = np.array(scene_changes)
    before = scene_changes[scene_changes <= moment]
    if len(before) > 0:
        return before[-1]
    return moment

if scene_changes:
    aligned_moments = [align_to_scene(m, scene_changes) for m in special_times]
else:
    aligned_moments = special_times

# --- Merge moments that are too close together ---
merged_moments = []
for moment in sorted(aligned_moments):
    if not merged_moments or moment - merged_moments[-1] >= min_gap_seconds:
        merged_moments.append(moment)
print(f'After merging and aligning, {len(merged_moments)} shorts will be created.')

# --- Extract shorts with optimized, scene-aligned moments ---
for idx, moment in enumerate(merged_moments):
    start = max(0, moment)
    out_clip = os.path.join(output_dir, f'pro_short_{idx+1:02d}.mp4')
    cmd = [
        'ffmpeg', '-y',
        '-i', video_path,
        '-ss', str(start),
        '-t', str(clip_duration),
        '-c:v', 'libx264',
        '-c:a', 'aac',
        out_clip
    ]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    print(f'Saved: {out_clip}')
print('All professional, scene-aligned shorts extracted!')

# --- Diagnostics ---
if not os.path.exists(video_path):
    print(f'❌ Main video file NOT found: {video_path}')
else:
    print(f'✅ Main video file found: {video_path}')
ffmpeg_path = shutil.which('ffmpeg')
if ffmpeg_path:
    print(f'✅ ffmpeg found at: {ffmpeg_path}')
else:
    print('❌ ffmpeg not found in system PATH. Please install ffmpeg.')
if merged_moments:
    print(f'✅ {len(merged_moments)} highlight moments detected.')
    print('Sample moments:', merged_moments[:5])
else:
    print('❌ No highlight moments detected. Check detection steps.')

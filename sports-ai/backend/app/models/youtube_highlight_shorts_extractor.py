
import os
import numpy as np
import subprocess
from pytubefix import YouTube
import librosa
import shutil

def extract_youtube_shorts(
    youtube_url,
    output_dir='highlight_shorts',
    clip_duration=30,
    energy_threshold=1.5,
    min_gap_seconds=45
):
    """
    Downloads a YouTube video, analyzes audio and video for highlights, and extracts shorts.
    Returns a list of paths to the generated short clips.
    """
    os.makedirs(output_dir, exist_ok=True)
    video_path = os.path.join(output_dir, 'video.mp4')
    audio_path = os.path.join(output_dir, 'audio.mp4')

    # Download main video
    if not os.path.exists(video_path):
        yt = YouTube(youtube_url)
        video_stream = yt.streams.filter(progressive=True, file_extension='mp4').order_by('resolution').desc().first()
        video_stream.download(output_path=output_dir, filename='video.mp4')
    # Download audio only
    if not os.path.exists(audio_path):
        yt = YouTube(youtube_url)
        audio_stream = yt.streams.filter(only_audio=True).first()
        audio_stream.download(output_path=output_dir, filename='audio.mp4')

    # Analyze audio for spikes
    y, sr = librosa.load(audio_path, sr=None)
    frame_length = sr
    hop_length = sr // 2
    energy = np.array([
        np.sum(np.abs(y[i:i+frame_length]))
        for i in range(0, len(y), hop_length)
    ])
    mean_energy = np.mean(energy)
    special_indices = np.where(energy > energy_threshold * mean_energy)[0]
    special_times = [int(i * hop_length / sr) for i in special_indices]

    # Scene Change Detection
    try:
        import cv2
        scene_changes = []
        cap = cv2.VideoCapture(video_path)
        prev_hist = None
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        scene_threshold = 0.6
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
    except ImportError:
        scene_changes = []

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

    merged_moments = []
    for moment in sorted(aligned_moments):
        if not merged_moments or moment - merged_moments[-1] >= min_gap_seconds:
            merged_moments.append(moment)

    shorts_paths = []
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
        shorts_paths.append(out_clip)

    return shorts_paths

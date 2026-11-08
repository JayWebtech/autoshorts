import unittest
import sys
import os
import subprocess
import shutil
import tempfile
from pathlib import Path
from PIL import Image
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from python_backend import media

class TestRenderSubtitlesAndCtaHardwareE2E(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp())
        self.source_video = Path(r"E:\Disco OLD\Streaming\01_Grabaciones\Roblox El nuevo vicio\Roblox El nuevo vicio.mp4")
        if not self.source_video.exists():
            self.skipTest("Source video not found on disk: E:\\Disco OLD\\Streaming\\01_Grabaciones\\Roblox El nuevo vicio\\Roblox El nuevo vicio.mp4")

    def tearDown(self):
        try:
            shutil.rmtree(self.test_dir, ignore_errors=True)
        except Exception:
            pass

    def test_real_hardware_ffmpeg_burns_subtitles_and_cta(self):
        # 1. Generate real CTA badge
        badge_path = self.test_dir / "test_badge.png"
        media.generate_cta_badge_image(
            text="❤️ ¡Sígueme y dale like!",
            output_path=str(badge_path),
            is_vertical=False,
            scale_factor=1.0
        )
        self.assertTrue(badge_path.exists(), "CTA badge PNG must exist")

        # 2. Generate real ASS subtitles (Canonical 1920x1080 virtual canvas)
        words = [
            {"start": 548.5, "end": 551.5, "text": "¡SUBTITULO"},
            {"start": 551.5, "end": 554.0, "text": "EN"},
            {"start": 554.0, "end": 556.0, "text": "PANTALLA!"}
        ]
        ass_content = media.generate_ass_subtitles(
            words=words,
            start_sec=548.39,
            end_sec=558.39, # 10 seconds duration
            caption_style="tiktok-karaoke",
            position="bottom",
            aspect_ratio="original",
            pos_x=960,
            pos_y=920,
            font_size_override=50,
            align_h="center",
            source_width=1280,
            source_height=720
        )
        ass_path = self.test_dir / "test_subs.ass"
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(ass_content)
        self.assertTrue(ass_path.exists(), "ASS file must exist")

        # 3. Escape subtitle filter path for FFmpeg
        ass_posix = ass_path.resolve().as_posix()
        drive = ass_posix[0]
        rest = ass_posix[2:].replace("'", r"'\''")
        sub_filter = f"ass='{drive}\\:{rest}'"

        output_mp4 = self.test_dir / "rendered_hardware_clip.mp4"

        # 4. Execute REAL hardware encoding via FFmpeg
        rendered = media.render_flat_clip(
            source_path=str(self.source_video),
            start_sec=548.39,
            end_sec=558.39,
            output_path=output_mp4,
            aspect_ratio="original",
            subtitle_filter=sub_filter,
            cta_badge_path=badge_path,
            cta_position="top",
            caption_position="bottom",
            cta_animation="bounce-land",
            cta_x=960, # will be scaled to 640 on 1280x720 video
            cta_y=90   # will be scaled to 60 on 1280x720 video
        )

        self.assertTrue(output_mp4.exists(), "Rendered MP4 file must exist")
        self.assertGreater(output_mp4.stat().st_size, 500_000, "Rendered MP4 must contain valid video stream")

        # 5. Extract frame at 2.5s (during subtitle display)
        frame_subs = self.test_dir / "frame_2_5s.jpg"
        subprocess.run([
            "ffmpeg", "-y", "-ss", "2.5", "-i", str(output_mp4),
            "-vframes", "1", str(frame_subs)
        ], check=True, capture_output=True)
        self.assertTrue(frame_subs.exists(), "Extracted subtitle frame must exist")

        # Verify subtitle pixels (yellow highlight or white text with dark outline)
        im_subs = Image.open(frame_subs)
        arr_subs = np.array(im_subs)
        yellow_subs = (arr_subs[:, :, 0] > 190) & (arr_subs[:, :, 1] > 170) & (arr_subs[:, :, 2] < 60)
        yellow_pixel_count = int(np.sum(yellow_subs))
        self.assertGreater(yellow_pixel_count, 100, f"Subtitles must be burned into frame! Found {yellow_pixel_count} yellow pixels")

        # 6. Extract frame at 3.5s (during CTA badge animation display)
        frame_cta = self.test_dir / "frame_3_5s.jpg"
        subprocess.run([
            "ffmpeg", "-y", "-ss", "3.5", "-i", str(output_mp4),
            "-vframes", "1", str(frame_cta)
        ], check=True, capture_output=True)
        self.assertTrue(frame_cta.exists(), "Extracted CTA frame must exist")

        # Verify CTA red heart pixels (R > 200, G < 60, B < 60)
        im_cta = Image.open(frame_cta)
        arr_cta = np.array(im_cta)
        red_heart = (arr_cta[:, :, 0] > 200) & (arr_cta[:, :, 1] < 60) & (arr_cta[:, :, 2] < 60)
        red_pixel_count = int(np.sum(red_heart))
        self.assertGreater(red_pixel_count, 50, f"CTA badge red heart must be burned into frame! Found {red_pixel_count} red pixels")

        # 7. Probe output with ffprobe
        probe = media.probe_media(str(output_mp4))
        self.assertTrue(probe.get("hasVideo"), "Output must have video")
        self.assertEqual(probe.get("width"), 1280)
        self.assertEqual(probe.get("height"), 720)
        self.assertAlmostEqual(probe.get("durationSec", 0), 10.0, delta=0.5)

if __name__ == "__main__":
    unittest.main()


import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from python_backend.media import generate_ass_subtitles

class TestAssSubtitleGeneration(unittest.TestCase):
    def test_ass_subtitle_playres_and_coordinates(self):
        words = [
            {"start": 10.0, "end": 10.5, "text": "¡HOLA"},
            {"start": 10.5, "end": 11.0, "text": "MUNDO!"}
        ]

        # Horizontal 16:9 / Original with horizontal dimensions (1280x720)
        ass_horizontal = generate_ass_subtitles(
            words=words,
            start_sec=10.0,
            end_sec=12.0,
            caption_style="tiktok-karaoke",
            position="bottom",
            aspect_ratio="original",
            pos_x=960,
            pos_y=920,
            source_width=1280,
            source_height=720
        )

        self.assertIn("PlayResX: 1920", ass_horizontal, "Horizontal ASS must use canonical 1920 PlayResX")
        self.assertIn("PlayResY: 1080", ass_horizontal, "Horizontal ASS must use canonical 1080 PlayResY")
        self.assertIn(r"\pos(960,920)", ass_horizontal, "Position tag must be present and correctly formatted")

        # Vertical 9:16
        ass_vertical = generate_ass_subtitles(
            words=words,
            start_sec=10.0,
            end_sec=12.0,
            caption_style="tiktok-karaoke",
            position="bottom",
            aspect_ratio="9:16",
            pos_x=540,
            pos_y=1680,
            source_width=1080,
            source_height=1920
        )

        self.assertIn("PlayResX: 1080", ass_vertical, "Vertical ASS must use canonical 1080 PlayResX")
        self.assertIn("PlayResY: 1920", ass_vertical, "Vertical ASS must use canonical 1920 PlayResY")
        self.assertIn(r"\pos(540,1680)", ass_vertical, "Position tag must match vertical canvas")

if __name__ == "__main__":
    unittest.main()

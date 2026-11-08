import unittest
import sys
import tempfile
import json
import shutil
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from python_backend.api import Api

class TestRenderFlatClipParametersIntegration(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.api = Api(self.test_dir)

        # Create project and candidate
        with self.api.db.get_conn() as conn:
            conn.execute("""
                INSERT INTO projects (id, name, source_path, source_duration, status, transcription_mode, caption_style, created_at, updated_at)
                VALUES ('proj-1', 'Test Game', 'C:/dummy/test.mp4', 120.0, 'ready', 'local', 'tiktok-karaoke', '2026-01-01', '2026-01-01')
            """)
            conn.commit()

        candidates = self.api.db.replace_candidates("proj-1", [{
            "start": 10.0,
            "end": 30.0,
            "score": 0.95,
            "hook": "Epic Moment",
            "rationale": "Clutch gameplay",
            "description": "Watch this #gaming",
            "hook_title": "Headshot!"
        }])
        self.cand_id = candidates[0]["id"]

        self.api.db.save_transcript(
            "proj-1",
            "faster-whisper",
            json.dumps({
                "words": [
                    {"start": 10.5, "end": 11.2, "text": "Increible"},
                    {"start": 11.3, "end": 12.0, "text": "disparo"}
                ]
            }),
            "es"
        )

    def tearDown(self):
        try:
            shutil.rmtree(self.test_dir, ignore_errors=True)
        except Exception:
            pass

    @patch("python_backend.api.probe_media")
    @patch("python_backend.api.render_flat_clip")
    def test_render_flat_clip_for_candidate_passes_custom_coordinates(self, mock_render, mock_probe):
        mock_probe.return_value = {
            "width": 1280,
            "height": 720,
            "durationSec": 120.0,
            "hasVideo": True,
            "fps": 60
        }
        mock_render.return_value = Path(self.test_dir) / "Clip 01 - Epic Moment.mp4"

        out_path = self.api.render_flat_clip_for_candidate({
            "candidateId": self.cand_id,
            "outputDir": self.test_dir,
            "aspectRatio": "original",
            "burnSubtitles": True,
            "captionStyle": "tiktok-karaoke",
            "captionX": 960,
            "captionY": 920,
            "ctaEnabled": True,
            "ctaText": "❤️ ¡Sígueme!",
            "ctaX": 960,
            "ctaY": 90,
            "ctaScale": 1.0
        })

        self.assertTrue(mock_render.called, "render_flat_clip must be invoked")
        kwargs = mock_render.call_args[1]

        # Verify coordinates are received
        self.assertEqual(kwargs.get("cta_x"), 960)
        self.assertEqual(kwargs.get("cta_y"), 90)
        self.assertIsNotNone(kwargs.get("subtitle_filter"), "subtitle_filter must not be None when burnSubtitles=True")
        self.assertIsNotNone(kwargs.get("cta_badge_path"), "cta_badge_path must not be None when ctaEnabled=True")

        # Verify .ass and .png files were generated in output directory
        ass_files = list(Path(self.test_dir).glob("*.ass"))
        self.assertTrue(len(ass_files) > 0, "ASS subtitle file must be created")
        with open(ass_files[0], "r", encoding="utf-8") as f:
            content = f.read()
            self.assertIn("PlayResX: 1920", content)
            self.assertIn("PlayResY: 1080", content)
            self.assertIn(r"\pos(960,920)", content)

        png_files = list(Path(self.test_dir).glob("*.png"))
        self.assertTrue(len(png_files) > 0, "CTA badge PNG image must be created")

if __name__ == "__main__":
    unittest.main()

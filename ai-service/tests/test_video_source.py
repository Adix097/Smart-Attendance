import base64
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from app.schemas import InferenceRequest
from app.video_source import resolved_video, resolved_video_bytes


class InferenceRequestVideoTests(unittest.TestCase):
    def test_accepts_a_video_path(self) -> None:
        request = InferenceRequest(video_path="/tmp/a.mp4", enrollment_dir="/tmp/enrollment")
        self.assertEqual(request.video_path, "/tmp/a.mp4")

    def test_accepts_an_upload(self) -> None:
        request = InferenceRequest(
            video_filename="a.mp4",
            video_data_base64="Zm9v",
            enrollment_dir="/tmp/enrollment",
        )
        self.assertEqual(request.video_filename, "a.mp4")

    def test_rejects_a_request_without_any_video(self) -> None:
        with self.assertRaises(ValidationError):
            InferenceRequest(enrollment_dir="/tmp/enrollment")

    def test_rejects_an_upload_missing_its_filename(self) -> None:
        with self.assertRaises(ValidationError):
            InferenceRequest(video_data_base64="Zm9v", enrollment_dir="/tmp/enrollment")


class ResolvedVideoTests(unittest.TestCase):
    def test_passes_a_path_through_untouched(self) -> None:
        with resolved_video("/tmp/classroom.mp4", None, None) as path:
            self.assertEqual(path, Path("/tmp/classroom.mp4"))

    def test_writes_an_upload_into_this_service_filesystem_and_cleans_up(self) -> None:
        payload = base64.b64encode(b"recorded-bytes").decode()

        with resolved_video(None, "classroom.mp4", payload) as path:
            self.assertTrue(path.is_file())
            self.assertEqual(path.read_bytes(), b"recorded-bytes")
            self.assertEqual(path.suffix, ".mp4")
            self.assertEqual(path.parent, Path(tempfile.gettempdir()))
            written = path

        self.assertFalse(written.exists())

    def test_prefers_the_upload_when_both_are_supplied(self) -> None:
        payload = base64.b64encode(b"recorded-bytes").decode()

        with resolved_video("/tmp/unreachable-on-this-host.mp4", "c.webm", payload) as path:
            self.assertEqual(path.suffix, ".webm")
            self.assertEqual(path.read_bytes(), b"recorded-bytes")

    def test_removes_the_upload_even_when_inference_raises(self) -> None:
        payload = base64.b64encode(b"recorded-bytes").decode()
        captured: Path | None = None

        with self.assertRaises(RuntimeError):
            with resolved_video(None, "classroom.mp4", payload) as path:
                captured = path
                raise RuntimeError("inference failed")

        self.assertIsNotNone(captured)
        assert captured is not None
        self.assertFalse(captured.exists())

    def test_rejects_an_unsupported_extension(self) -> None:
        payload = base64.b64encode(b"recorded-bytes").decode()

        with self.assertRaisesRegex(ValueError, "Unsupported video format"):
            with resolved_video(None, "classroom.txt", payload):
                pass

    def test_rejects_invalid_base64(self) -> None:
        with self.assertRaisesRegex(ValueError, "not valid base64"):
            with resolved_video(None, "classroom.mp4", "not-base64!!"):
                pass

    def test_rejects_an_empty_upload(self) -> None:
        with self.assertRaisesRegex(ValueError, "empty"):
            with resolved_video(None, "classroom.mp4", ""):
                pass

    def test_writes_raw_multipart_bytes(self) -> None:
        with resolved_video_bytes("classroom.mp4", b"raw-bytes") as path:
            self.assertTrue(path.is_file())
            self.assertEqual(path.read_bytes(), b"raw-bytes")
            written = path
        self.assertFalse(written.exists())

    def test_rejects_empty_multipart_bytes(self) -> None:
        with self.assertRaisesRegex(ValueError, "empty"):
            with resolved_video_bytes("classroom.mp4", b""):
                pass

    def test_rejects_a_request_with_no_source(self) -> None:
        with self.assertRaisesRegex(ValueError, "No video source"):
            with resolved_video(None, None, None):
                pass


if __name__ == "__main__":
    unittest.main()

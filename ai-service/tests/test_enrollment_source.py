import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from app.config import PROJECT_ROOT, EnrollmentConfig, InferenceConfig
from app.recognition import enrollment_source
from app.recognition.enrollment_source import (
    EnrollmentSourceError,
    load_enrollment_gallery,
    refresh_enrollment_gallery,
)
from app.recognition.gallery import EnrollmentGallery

LIST_URL = "/storage/v1/object/list/enrollment"


def supabase_config(cache_dir: str) -> EnrollmentConfig:
    return EnrollmentConfig(
        source="supabase",
        supabase_url="https://project.supabase.co",
        supabase_service_role_key="service-role-key",
        supabase_bucket="enrollment",
        cache_dir=cache_dir,
    )


def gallery(*identities: str) -> EnrollmentGallery:
    return EnrollmentGallery(
        embeddings={identity: [] for identity in identities},
        accepted_images=len(identities),
        rejected_images=0,
    )


def fake_storage(listings: dict[str, list[dict[str, object]]]):
    """Serves POST listings from `listings` and GET downloads as fixed bytes."""

    def handler(config, url, payload=None):
        if payload is None:
            return b"image-bytes"
        prefix = str(payload["prefix"])
        offset = int(payload["offset"])
        page = listings.get(prefix, []) if offset == 0 else []
        return json.dumps(page).encode("utf-8")

    return handler


class EnrollmentConfigTests(unittest.TestCase):
    def test_rejects_unknown_source(self) -> None:
        with self.assertRaisesRegex(ValueError, "ENROLLMENT_SOURCE must be one of"):
            EnrollmentConfig(source="s3")

    def test_supabase_requires_credentials(self) -> None:
        with self.assertRaisesRegex(ValueError, "SUPABASE_SERVICE_ROLE_KEY"):
            EnrollmentConfig(
                source="supabase",
                supabase_url="https://project.supabase.co",
                supabase_service_role_key="",
            )

    def test_local_source_needs_no_credentials(self) -> None:
        self.assertEqual(EnrollmentConfig(source="local").source, "local")

    def test_cache_dir_defaults_into_temp_directory(self) -> None:
        resolved = EnrollmentConfig(source="local").resolved_cache_dir()
        self.assertEqual(resolved.parent, Path(tempfile.gettempdir()))

    def test_env_file_is_resolved_from_the_project_directory(self) -> None:
        self.assertEqual(PROJECT_ROOT, Path(__file__).resolve().parents[1])
        self.assertTrue((PROJECT_ROOT / "app" / "config.py").is_file())

    def test_process_environment_overrides_dotenv_file(self) -> None:
        import os
        import subprocess
        import sys

        env = os.environ.copy()
        env["ENROLLMENT_SOURCE"] = "local"
        env["PYTHONPATH"] = str(PROJECT_ROOT)
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "from app.config import enrollment_settings; print(enrollment_settings.source)",
            ],
            cwd=tempfile.gettempdir(),
            env=env,
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(result.stdout.strip(), "local")


class EnrollmentSourceTests(unittest.TestCase):
    def setUp(self) -> None:
        enrollment_source._synced_dir = None
        enrollment_source._gallery_cache.clear()
        self.addCleanup(enrollment_source._gallery_cache.clear)
        self.addCleanup(setattr, enrollment_source, "_synced_dir", None)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cache_dir = str(Path(self.temp.name) / "gallery")
        self.inference_config = InferenceConfig()

    def load(self, config: EnrollmentConfig, requested: str = "data/enrollment"):
        return load_enrollment_gallery(
            analysis=object(),
            requested_dir=Path(requested),
            config=self.inference_config,
            enrollment_config=config,
        )

    def test_local_source_reads_requested_directory_every_call(self) -> None:
        config = EnrollmentConfig(source="local")
        with mock.patch.object(
            enrollment_source, "load_gallery", return_value=gallery("14119051925")
        ) as load:
            self.load(config)
            self.load(config)

        self.assertEqual(load.call_count, 2)
        self.assertEqual(load.call_args.args[1], Path("data/enrollment"))

    def test_supabase_source_downloads_bucket_and_caches_gallery(self) -> None:
        config = supabase_config(self.cache_dir)
        storage = fake_storage(
            {
                "": [
                    {"name": "14119051925", "id": None},
                    {"name": "12819051925", "id": None},
                ],
                "14119051925/": [{"name": "photo.jpg", "id": "a"}],
                "12819051925/": [{"name": "photo.jpg", "id": "b"}],
            }
        )

        with mock.patch.object(enrollment_source, "_storage_request", storage), mock.patch.object(
            enrollment_source, "load_gallery", return_value=gallery("14119051925")
        ) as load:
            self.load(config)
            self.load(config)

        self.assertEqual(load.call_count, 1)
        self.assertEqual(load.call_args.args[1], Path(self.cache_dir))
        self.assertEqual(
            (Path(self.cache_dir) / "14119051925" / "photo.jpg").read_bytes(),
            b"image-bytes",
        )
        self.assertTrue((Path(self.cache_dir) / "12819051925" / "photo.jpg").is_file())
        self.assertFalse(Path(f"{self.cache_dir}.partial").exists())

    def test_supabase_source_accepts_folder_names_with_a_trailing_slash(self) -> None:
        config = supabase_config(self.cache_dir)
        storage = fake_storage(
            {
                "": [{"name": "14119051925/", "id": None}],
                "14119051925/": [{"name": "photo.jpg", "id": "a"}],
            }
        )

        with mock.patch.object(enrollment_source, "_storage_request", storage), mock.patch.object(
            enrollment_source, "load_gallery", return_value=gallery("14119051925")
        ):
            self.load(config)

        self.assertTrue((Path(self.cache_dir) / "14119051925" / "photo.jpg").is_file())

    def test_supabase_source_ignores_non_image_and_unsafe_names(self) -> None:
        config = supabase_config(self.cache_dir)
        storage = fake_storage(
            {
                "": [
                    {"name": "14119051925", "id": None},
                    {"name": "../escape", "id": None},
                    {"name": ".emptyFolderPlaceholder", "id": "z"},
                ],
                "14119051925/": [
                    {"name": "photo.jpg", "id": "a"},
                    {"name": "notes.txt", "id": "b"},
                    {"name": "../escape.jpg", "id": "c"},
                ],
            }
        )

        with mock.patch.object(enrollment_source, "_storage_request", storage), mock.patch.object(
            enrollment_source, "load_gallery", return_value=gallery("14119051925")
        ):
            self.load(config)

        identity_dir = Path(self.cache_dir) / "14119051925"
        self.assertEqual([path.name for path in identity_dir.iterdir()], ["photo.jpg"])
        self.assertEqual([path.name for path in Path(self.cache_dir).iterdir()], ["14119051925"])

    def test_empty_bucket_is_reported(self) -> None:
        config = supabase_config(self.cache_dir)
        with mock.patch.object(enrollment_source, "_storage_request", fake_storage({"": []})):
            with self.assertRaisesRegex(EnrollmentSourceError, "no enrollment images"):
                self.load(config)

    def test_authentication_failure_is_reported(self) -> None:
        config = supabase_config(self.cache_dir)
        error = urllib.error.HTTPError(LIST_URL, 401, "Unauthorized", {}, None)  # type: ignore[arg-type]
        with mock.patch.object(enrollment_source.urllib.request, "urlopen", side_effect=error):
            with self.assertRaisesRegex(EnrollmentSourceError, "rejected the service-role"):
                self.load(config)

    def test_missing_bucket_is_reported(self) -> None:
        config = supabase_config(self.cache_dir)
        error = urllib.error.HTTPError(LIST_URL, 404, "Not Found", {}, None)  # type: ignore[arg-type]
        with mock.patch.object(enrollment_source.urllib.request, "urlopen", side_effect=error):
            with self.assertRaisesRegex(EnrollmentSourceError, "not found"):
                self.load(config)

    def test_unreachable_storage_is_reported(self) -> None:
        config = supabase_config(self.cache_dir)
        error = urllib.error.URLError("connection refused")
        with mock.patch.object(enrollment_source.urllib.request, "urlopen", side_effect=error):
            with self.assertRaisesRegex(EnrollmentSourceError, "Unable to reach Supabase Storage"):
                self.load(config)

    def test_failed_refresh_keeps_the_cached_gallery(self) -> None:
        config = supabase_config(self.cache_dir)
        storage = fake_storage(
            {"": [{"name": "14119051925", "id": None}], "14119051925/": [{"name": "photo.jpg", "id": "a"}]}
        )

        with mock.patch.object(
            enrollment_source, "load_gallery", return_value=gallery("14119051925")
        ) as load:
            with mock.patch.object(enrollment_source, "_storage_request", storage):
                self.load(config)

            unreachable = mock.Mock(
                side_effect=EnrollmentSourceError("Unable to reach Supabase Storage")
            )
            with mock.patch.object(enrollment_source, "_storage_request", unreachable):
                with self.assertRaises(EnrollmentSourceError):
                    refresh_enrollment_gallery(config)

            with mock.patch.object(enrollment_source, "_storage_request", storage):
                self.load(config)

        self.assertEqual(load.call_count, 1)
        self.assertTrue((Path(self.cache_dir) / "14119051925" / "photo.jpg").is_file())

    def test_refresh_resyncs_and_rebuilds_the_gallery(self) -> None:
        config = supabase_config(self.cache_dir)
        storage = fake_storage(
            {"": [{"name": "14119051925", "id": None}], "14119051925/": [{"name": "photo.jpg", "id": "a"}]}
        )

        with mock.patch.object(enrollment_source, "_storage_request", storage), mock.patch.object(
            enrollment_source, "load_gallery", return_value=gallery("14119051925")
        ) as load:
            self.load(config)
            refreshed = refresh_enrollment_gallery(config)
            self.load(config)

        self.assertEqual(refreshed.identities, 1)
        self.assertEqual(refreshed.images, 1)
        self.assertEqual(refreshed.warnings, [])
        self.assertEqual(load.call_count, 2)

    def test_refresh_is_a_no_op_for_the_local_source(self) -> None:
        refreshed = refresh_enrollment_gallery(EnrollmentConfig(source="local"))

        self.assertEqual(refreshed.source, "local")
        self.assertEqual(refreshed.images, 0)
        self.assertEqual(len(refreshed.warnings), 1)


if __name__ == "__main__":
    unittest.main()

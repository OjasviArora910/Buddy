import os
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from google.auth.exceptions import RefreshError

from app.auth import firebase_auth
from app.main import app
from fastapi.testclient import TestClient


class FirebaseTokenTests(unittest.TestCase):
    def test_valid_token_is_verified_against_expected_project(self):
        claims = {"uid": "uid-1", "aud": "buddy-test"}
        with patch.dict(os.environ, {"FIREBASE_PROJECT_ID": "buddy-test"}), \
             patch.object(firebase_auth, "firebase_app", return_value=object()), \
             patch.object(firebase_auth.auth, "verify_id_token", return_value=claims) as verify:
            self.assertEqual(firebase_auth.verify_token("token"), claims)
            verify.assert_called_once()

    def test_wrong_project_is_rejected(self):
        with patch.dict(os.environ, {"FIREBASE_PROJECT_ID": "expected"}), \
             patch.object(firebase_auth, "firebase_app", return_value=object()), \
             patch.object(firebase_auth.auth, "verify_id_token", return_value={"uid": "u", "aud": "other"}):
            with self.assertRaises(HTTPException) as error:
                firebase_auth.verify_token("token")
            self.assertEqual(error.exception.status_code, 401)

    def test_invalid_or_expired_token_is_rejected(self):
        with patch.dict(os.environ, {"FIREBASE_PROJECT_ID": "expected"}), \
             patch.object(firebase_auth, "firebase_app", return_value=object()), \
             patch.object(firebase_auth.auth, "verify_id_token", side_effect=ValueError("expired")):
            with self.assertRaises(HTTPException):
                firebase_auth.verify_token("bad")

    def test_firebase_configuration_failure_is_503_not_401(self):
        with patch.object(firebase_auth, "firebase_app", side_effect=RuntimeError("missing credentials")):
            with self.assertRaises(HTTPException) as error:
                firebase_auth.verify_token("token")
            self.assertEqual(error.exception.status_code, 503)

    def test_firebase_transport_failure_is_503_not_401(self):
        with patch.object(firebase_auth, "firebase_app", return_value=object()), \
             patch.object(firebase_auth.auth, "verify_id_token", side_effect=RuntimeError("certificate fetch failed")):
            with self.assertRaises(HTTPException) as error:
                firebase_auth.verify_token("token")
            self.assertEqual(error.exception.status_code, 503)

    def test_initializes_with_project_option_and_falls_back_from_stale_key_path(self):
        app_stub = type("App", (), {"project_id": "buddy-test"})()
        with patch.dict(os.environ, {"FIREBASE_PROJECT_ID": "buddy-test", "GOOGLE_APPLICATION_CREDENTIALS": "missing-private-key.json"}), \
             patch.object(firebase_auth.firebase_admin, "get_app", side_effect=ValueError()), \
             patch.object(firebase_auth.firebase_admin, "initialize_app", return_value=app_stub) as initialize:
            self.assertIs(firebase_auth.firebase_app(), app_stub)
            initialize.assert_called_once_with(options={"projectId": "buddy-test"})
            self.assertNotIn("GOOGLE_APPLICATION_CREDENTIALS", os.environ)

    def test_adc_iam_failure_is_service_error_not_bad_token(self):
        with patch.object(firebase_auth, "firebase_app", side_effect=RefreshError("403 permission denied")):
            with self.assertRaises(HTTPException) as error:
                firebase_auth.verify_token("token")
            self.assertEqual(error.exception.status_code, 503)
            self.assertIn("permissions", error.exception.detail)

    def test_existing_admin_app_must_match_configured_project(self):
        app_stub = type("App", (), {"project_id": "different-project"})()
        with patch.dict(os.environ, {"FIREBASE_PROJECT_ID": "expected-project"}), \
             patch.object(firebase_auth.firebase_admin, "get_app", return_value=app_stub):
            with self.assertRaises(RuntimeError):
                firebase_auth.firebase_app()

    def test_missing_bearer_token_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            firebase_auth.verified_firebase_uid(None)
        self.assertEqual(error.exception.status_code, 401)

    def test_profile_endpoint_rejects_missing_token_before_database_access(self):
        response = TestClient(app).get("/auth/me")
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()

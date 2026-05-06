import os
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/drive.file"]

CREDENTIALS_PATH = str(Path(__file__).parent.parent / "credentials.json")
TOKEN_PATH = str(Path(__file__).parent.parent / "token.json")


def _get_service():
    if not Path(CREDENTIALS_PATH).exists():
        raise RuntimeError(
            f"Google credentials file not found at {CREDENTIALS_PATH}. "
            "Download credentials.json from Google Cloud Console and place it there."
        )

    creds = None
    if Path(TOKEN_PATH).exists():
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
            creds = flow.run_local_server(port=0, open_browser=False)
        Path(TOKEN_PATH).write_text(creds.to_json())

    return build("drive", "v3", credentials=creds)


def _find_folder(service, name: str, parent_id: str | None = None) -> str | None:
    parent_clause = f"and '{parent_id}' in parents" if parent_id else "and 'root' in parents"
    q = (
        f"name='{name}' and mimeType='application/vnd.google-apps.folder' "
        f"{parent_clause} and trashed=false"
    )
    results = service.files().list(q=q, fields="files(id)", pageSize=1).execute()
    files = results.get("files", [])
    return files[0]["id"] if files else None


def _create_folder(service, name: str, parent_id: str) -> str:
    metadata = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    return folder["id"]


def upload_to_drive(pdf_path: str, course: str, root_folder_name: str) -> str:
    """Upload pdf_path to Drive at root_folder_name/course/. Returns the Drive file URL."""
    try:
        service = _get_service()

        root_id = _find_folder(service, root_folder_name)
        if not root_id:
            root_id = _create_folder(service, root_folder_name, "root")

        course_id = _find_folder(service, course, root_id)
        if not course_id:
            course_id = _create_folder(service, course, root_id)

        file_name = Path(pdf_path).name
        media = MediaFileUpload(pdf_path, mimetype="application/pdf")
        response = (
            service.files()
            .create(
                body={"name": file_name, "parents": [course_id]},
                media_body=media,
                fields="id,webViewLink",
            )
            .execute()
        )
        return response["webViewLink"]
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(str(e)) from e

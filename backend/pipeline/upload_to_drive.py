import os
from pathlib import Path

from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from services.google_auth import get_credentials
from timing import timed_pipeline


def _get_service():
    creds = get_credentials("drive")
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


@timed_pipeline("drive")
def upload_to_drive(
    pdf_path: str,
    course: str,
    file_name: str | None = None,
    subfolder: str | None = None,
) -> str:
    """Upload pdf_path to Drive at GDRIVE_ROOT_FOLDER/course/[subfolder/]. Returns the Drive file URL."""
    root_folder_name = os.environ.get("GDRIVE_ROOT_FOLDER")
    if not root_folder_name:
        raise RuntimeError("GDRIVE_ROOT_FOLDER is not set in the environment")
    try:
        service = _get_service()

        root_id = _find_folder(service, root_folder_name)
        if not root_id:
            root_id = _create_folder(service, root_folder_name, "root")

        course_id = _find_folder(service, course, root_id)
        if not course_id:
            course_id = _create_folder(service, course, root_id)

        parent_id = course_id
        if subfolder:
            sub_id = _find_folder(service, subfolder, course_id)
            if not sub_id:
                sub_id = _create_folder(service, subfolder, course_id)
            parent_id = sub_id

        file_name = file_name or Path(pdf_path).name
        media = MediaFileUpload(pdf_path, mimetype="application/pdf")
        response = (
            service.files()
            .create(
                body={"name": file_name, "parents": [parent_id]},
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

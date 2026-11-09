"""Summary figures: the figures/ folder routes, name validation, listing order and the video-PUT wipe."""

import pytest
from fastapi.testclient import TestClient

BASE = "/courses/Algo/lectures/L1"


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


@pytest.fixture
def lecture(data_root):
    """An existing lecture dir."""

    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    return d


def test_round_trip_write_list_read_clear(client, lecture):
    assert client.put(f"{BASE}/figures/fig1.pdf", content=b"%PDF").status_code == 204
    assert client.put(f"{BASE}/figures/fig2.png", content=b"\x89PNG").status_code == 204
    assert (lecture / "figures" / "fig1.pdf").read_bytes() == b"%PDF"

    assert client.get(f"{BASE}/figures").json() == {"figures": ["fig1.pdf", "fig2.png"]}
    r = client.get(f"{BASE}/figures/fig2.png")
    assert (r.status_code, r.content, r.headers["content-type"]) == (
        200,
        b"\x89PNG",
        "image/png",
    )
    assert (
        client.get(f"{BASE}/figures/fig1.pdf").headers["content-type"]
        == "application/pdf"
    )

    assert client.delete(f"{BASE}/figures").status_code == 204
    assert client.get(f"{BASE}/figures").json() == {"figures": []}
    assert not (lecture / "figures").exists()
    # Clearing an already-empty set is a no-op.
    assert client.delete(f"{BASE}/figures").status_code == 204


def test_recitation_kind_uses_the_recitations_dir(client, data_root):
    d = data_root / "Algo" / "Recitations" / "R1"
    d.mkdir(parents=True)
    url = "/courses/Algo/lectures/R1/figures"
    assert (
        client.put(f"{url}/fig1.jpg?kind=recitation", content=b"j").status_code == 204
    )
    assert (d / "figures" / "fig1.jpg").exists()
    assert client.get(f"{url}?kind=recitation").json() == {"figures": ["fig1.jpg"]}
    assert client.get(url).json() == {"figures": []}


def test_listing_is_natural_order_and_ignores_strays(client, lecture):
    for n in (10, 2, 1, 11):
        client.put(f"{BASE}/figures/fig{n}.png", content=b"x")
    (lecture / "figures" / "notes.txt").write_bytes(b"x")
    assert client.get(f"{BASE}/figures").json()["figures"] == [
        "fig1.png",
        "fig2.png",
        "fig10.png",
        "fig11.png",
    ]


@pytest.mark.parametrize(
    "name",
    [
        "fig1.exe",
        "fig1.svg",
        "fig.png",
        "figx.png",
        "x.png",
        "fig1",
        "FIG1.PNG",
        "fig1.png.exe",
        "%2e%2e",
        "..%2Ffig1.png",
        "a%5Cfig1.png",
        "fig1.png%00",
    ],
)
def test_bad_names_are_rejected_on_write_and_read(client, lecture, name):
    r = client.put(f"{BASE}/figures/{name}", content=b"x")
    # Either the name check (400) or the router (404) refuses it; what matters is that nothing is written.
    assert r.status_code in (400, 404)
    assert not (lecture / "figures").exists()
    r = client.get(f"{BASE}/figures/{name}")
    assert r.status_code in (400, 404)


def test_invalid_name_error_shape(client, lecture):
    r = client.put(f"{BASE}/figures/fig1.exe", content=b"x")
    assert r.status_code == 400
    assert r.json()["code"] == "figure_name_invalid"
    assert r.json()["params"] == {"name": "fig1.exe"}


def test_missing_lecture_and_missing_figure(client, data_root):
    (data_root / "Algo").mkdir()
    r = client.put(f"{BASE}/figures/fig1.png", content=b"x")
    assert (r.status_code, r.json()["code"]) == (404, "lecture_not_found")
    assert not (data_root / "Algo" / "L1").exists()
    assert client.get(f"{BASE}/figures").json() == {"figures": []}
    assert client.delete(f"{BASE}/figures").status_code == 404
    r = client.get(f"{BASE}/figures/fig1.png")
    assert (r.status_code, r.json()["code"]) == (404, "file_not_found")


def test_figures_do_not_show_in_the_tree(client, lecture):
    client.put(f"{BASE}/figures/fig1.png", content=b"x")
    course = client.get("/tree").json()[0]
    assert [l["name"] for l in course["lectures"]] == ["L1"]
    assert course["lectures"][0]["materials"] == []


def test_video_put_wipes_figures_and_keeps_materials(client, lecture):
    (lecture / "material.pdf").write_bytes(b"%PDF")
    client.put(f"{BASE}/figures/fig1.png", content=b"x")
    r = client.put(f"{BASE}/video", content=b"\x00mp4")
    assert r.status_code == 204
    assert sorted(p.name for p in lecture.iterdir()) == ["material.pdf", "video.mp4"]


def test_files_put_and_summary_put_leave_figures_alone(client, lecture):
    client.put(f"{BASE}/figures/fig1.png", content=b"x")
    client.put(f"{BASE}/files/summary.pdf", content=b"x")
    client.put(f"{BASE}/summary?fresh=true", content=b"# s")
    assert client.get(f"{BASE}/figures").json() == {"figures": ["fig1.png"]}

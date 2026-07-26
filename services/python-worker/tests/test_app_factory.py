from app.app_factory import create_app


def test_app_factory_registers_extracted_routes_once() -> None:
    app = create_app()
    paths = app.openapi()["paths"]

    assert app.title == "ORBIT Python Worker"
    assert app.version == "0.1.0"
    assert "/health" in paths
    assert "/extract/reference" in paths
    assert "/references/index" in paths
    assert "/references/search" in paths

    assert set(paths["/health"]) == {"get"}
    assert set(paths["/extract/reference"]) == {"post"}
    assert set(paths["/references/index"]) == {"post"}
    assert set(paths["/references/search"]) == {"post"}

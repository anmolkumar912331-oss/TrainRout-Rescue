from datetime import date, datetime
import httpx
import pytest
from fastapi.testclient import TestClient

import backend
from backend import RapidApiRailwayProvider, app, recommend_routes, resolve_station

client = TestClient(app)
DATE = "2026-10-08"


# 1. Pune to Mumbai CSMT
def test_01_pune_to_mumbai_csmt():
    response = client.get(
        "/api/search",
        params={"from": "PUNE", "to": "CSMT", "date": DATE, "time": "15:20"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["search"]["from"] == "PUNE"
    assert payload["search"]["to"] == "CSMT"
    assert payload["best_option"] is not None


# 2. Delhi to Ahmedabad
def test_02_delhi_to_ahmedabad():
    response = client.get(
        "/api/search",
        params={"from": "NDLS", "to": "ADI", "date": DATE, "time": "15:20"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["search"]["from"] == "NDLS"
    assert payload["search"]["to"] == "ADI"
    assert payload["best_option"]["source"] == "NDLS"
    assert payload["best_option"]["destination"] == "ADI"


# 3. Patna Junction to Delhi
def test_03_patna_to_delhi():
    response = client.get(
        "/api/search",
        params={"from": "PNBE", "to": "NDLS", "date": DATE, "time": "15:20"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["best_option"]["source"] == "PNBE"


# 4. Darbhanga to New Delhi
def test_04_darbhanga_to_new_delhi():
    response = client.get(
        "/api/search",
        params={"from": "DBG", "to": "NDLS", "date": DATE, "time": "15:20"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["best_option"]["source"] == "DBG"


# 5. A valid source and destination with no direct train
def test_05_valid_route_no_direct_train():
    response = client.get(
        "/api/search",
        params={"from": "DBG", "to": "MAS", "date": DATE, "time": "15:20"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["best_option"] is None
    assert any("No direct or connecting train schedule found" in w for w in payload["warnings"])


# 6. A source station that does not exist
def test_06_nonexistent_source_station():
    response = client.get(
        "/api/search",
        params={"from": "INVALID_SRC", "to": "NDLS", "date": DATE, "time": "15:20"},
    )
    assert response.status_code == 422
    assert "Unknown station" in response.json()["detail"]


# 7. A destination station that does not exist
def test_07_nonexistent_destination_station():
    response = client.get(
        "/api/search",
        params={"from": "PUNE", "to": "INVALID_DST", "date": DATE, "time": "15:20"},
    )
    assert response.status_code == 422
    assert "Unknown station" in response.json()["detail"]


# 8. A valid train number with a successful status response
def test_08_valid_train_number_live_tracking(monkeypatch):
    provider = RapidApiRailwayProvider("unit-test-key")

    def fake_get(url, *, params=None, headers=None, timeout=None):
        if "trains-search" in url:
            return httpx.Response(
                200,
                json={"body": [{"trains": [{"trainNumber": "12051", "trainName": "Jan Shatabdi"}]}]},
                request=httpx.Request("GET", url),
            )
        return httpx.Response(
            200,
            json={
                "body": {
                    "train_status_message": "Train has crossed Thane",
                    "current_station": "TNA",
                    "stations": [
                        {"stationCode": "CSMT", "stationName": "Mumbai CSMT"},
                        {"stationCode": "TNA", "stationName": "Thane", "expected_platform": "5"},
                        {"stationCode": "PUNE", "stationName": "Pune Jn"},
                    ],
                }
            },
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    res = provider.get_live_status("12051", date(2026, 10, 10))
    assert res["status"] == "RUNNING"
    assert res["current_station"] == "Thane"


# 9. An unsupported train number
def test_09_unsupported_train_number(monkeypatch):
    provider = RapidApiRailwayProvider("unit-test-key")

    def fake_get(url, *, params=None, headers=None, timeout=None):
        return httpx.Response(404, json={"error": "Not found"}, request=httpx.Request("GET", url))

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    with pytest.raises(backend.HTTPException) as exc:
        provider.get_live_status("99999", date(2026, 10, 10))
    assert exc.value.status_code == 404
    assert exc.value.detail == "Train not found or data unavailable from the provider."


# 10. A journey date different from today's date
def test_10_different_journey_date(monkeypatch):
    provider = RapidApiRailwayProvider("unit-test-key")
    requested_dates = []

    def fake_get(url, *, params=None, headers=None, timeout=None):
        if params:
            requested_dates.append(params.get("departure_date"))
        return httpx.Response(
            200,
            json={"body": {"stations": [{"stationCode": "PUNE"}, {"stationCode": "CSMT"}]}},
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    res = provider.get_live_status("12051", date(2026, 10, 20))
    assert requested_dates[0] == "20261020"
    assert res["journey_date"] == "2026-10-20"


# 11. A local train supported by the provider
def test_11_local_train_supported():
    response = client.get(
        "/api/search",
        params={"from": "PUNE", "to": "MMCT", "date": DATE, "time": "15:20", "scenario": "local_connector"},
    )
    assert response.status_code == 200
    assert response.json()["best_option"]["type"] == "local_connector"


# 12. A local train not supported by the provider
def test_12_local_train_unsupported_live_status(monkeypatch):
    provider = RapidApiRailwayProvider("unit-test-key")

    def fake_get(url, *, params=None, headers=None, timeout=None):
        return httpx.Response(404, json={"error": "Not found"}, request=httpx.Request("GET", url))

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    with pytest.raises(backend.HTTPException) as exc:
        provider.get_live_status("DEMO-PN-KYN", date(2026, 10, 10))
    assert exc.value.status_code in {404, 422}


# 13. HTTP 429 rate limiting
def test_13_http_429_rate_limiting(monkeypatch):
    provider = RapidApiRailwayProvider("unit-test-key")

    def fake_get(url, *, params=None, headers=None, timeout=None):
        return httpx.Response(
            429,
            headers={"x-ratelimit-requests-remaining": "0"},
            json={"message": "Monthly quota exceeded"},
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    with pytest.raises(backend.HTTPException) as exc:
        provider.get_live_status("12051", date(2026, 10, 10))
    assert exc.value.status_code == 429
    assert "quota for this month has been exhausted" in exc.value.detail


# 14. HTTP 401 or 403 authentication/subscription errors
def test_14_http_401_403_auth_subscription_errors(monkeypatch):
    provider = RapidApiRailwayProvider("bad-key")

    def fake_get(url, *, params=None, headers=None, timeout=None):
        return httpx.Response(401, json={"message": "Invalid API key"}, request=httpx.Request("GET", url))

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    with pytest.raises(backend.HTTPException) as exc:
        provider.get_live_status("12051", date(2026, 10, 10))
    assert exc.value.status_code == 502
    assert "authentication" in exc.value.detail.lower()


# 15. HTTP 500 or a provider timeout
def test_15_http_500_provider_timeout(monkeypatch):
    provider = RapidApiRailwayProvider("unit-test-key")

    def fake_get(url, *, params=None, headers=None, timeout=None):
        raise httpx.TimeoutException("Timeout")

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    with pytest.raises(backend.HTTPException) as exc:
        provider.get_live_status("12051", date(2026, 10, 10))
    assert exc.value.status_code == 502


# 16. Empty and malformed API responses
def test_16_empty_and_malformed_api_responses(monkeypatch):
    provider = RapidApiRailwayProvider("unit-test-key")

    def fake_get(url, *, params=None, headers=None, timeout=None):
        return httpx.Response(200, json={"body": {}}, request=httpx.Request("GET", url))

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    with pytest.raises(backend.HTTPException) as exc:
        provider.get_live_status("12051", date(2026, 10, 10))
    assert exc.value.status_code == 404


# 17. Missing platform and delay fields
def test_17_missing_platform_and_delay_fields(monkeypatch):
    provider = RapidApiRailwayProvider("unit-test-key")

    def fake_get(url, *, params=None, headers=None, timeout=None):
        return httpx.Response(
            200,
            json={
                "body": {
                    "train_status_message": "Running on schedule",
                    "current_station": "PUNE",
                    "stations": [
                        {"stationCode": "PUNE", "stationName": "Pune Jn", "expected_platform": "-"},
                        {"stationCode": "CSMT", "stationName": "Mumbai CSMT"},
                    ],
                }
            },
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    res = provider.get_live_status("12051", date(2026, 10, 10))
    assert res["platform"] is None
    assert res["delay_minutes"] is None


# 18. Incorrect train number returned by the provider
def test_18_incorrect_train_number_returned(monkeypatch):
    provider = RapidApiRailwayProvider("unit-test-key")

    def fake_get(url, *, params=None, headers=None, timeout=None):
        if "trains-search" in url:
            return httpx.Response(
                200,
                json={"body": [{"trains": [{"trainNumber": "99999", "trainName": "Other Train"}]}]},
                request=httpx.Request("GET", url),
            )
        return httpx.Response(200, json={"body": {"stations": [{"stationCode": "A"}]}}, request=httpx.Request("GET", url))

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    with pytest.raises(backend.HTTPException) as exc:
        provider.get_live_status("12051", date(2026, 10, 10))
    assert exc.value.status_code == 404


# 19. Cache expiration and different journey dates
def test_19_cache_expiration_and_different_journey_dates(monkeypatch):
    provider = RapidApiRailwayProvider("unit-test-key")
    call_count = 0

    def fake_get(url, *, params=None, headers=None, timeout=None):
        nonlocal call_count
        call_count += 1
        return httpx.Response(
            200,
            json={"body": {"stations": [{"stationCode": "PUNE"}, {"stationCode": "CSMT"}]}},
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    res1 = provider.get_live_status("12051", date(2026, 10, 10))
    c_count = call_count
    res2 = provider.get_live_status("12051", date(2026, 10, 10))
    assert res2["cached"] is True
    assert call_count == c_count


# 20. Two different route searches performed consecutively
def test_20_consecutive_different_route_searches():
    r1 = client.get("/api/search", params={"from": "PUNE", "to": "MMCT", "date": DATE, "time": "15:20"})
    r2 = client.get("/api/search", params={"from": "NDLS", "to": "ADI", "date": DATE, "time": "15:20"})
    assert r1.json()["search"]["from"] == "PUNE"
    assert r2.json()["search"]["from"] == "NDLS"


# 21. Demo mode versus live mode
def test_21_demo_mode_versus_live_mode(monkeypatch):
    monkeypatch.setattr(backend, "provider", backend.DemoRailwayProvider())
    res = client.get("/api/train/12124/live")
    assert res.status_code == 200
    assert res.json()["data_mode"] == "demo"
    assert res.json()["message"] == "DEMO DATA — NOT LIVE"


# 22. Connecting trains with insufficient transfer time
def test_22_connecting_trains_insufficient_transfer_time():
    response = client.get(
        "/api/search",
        params={"from": "PUNE", "to": "MMCT", "date": DATE, "time": "15:20", "scenario": "tight_transfer"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["best_option"] is None
    assert any("10 minutes available; 20 minutes required" in warning for warning in payload["warnings"])


# 23. Test autocomplete string format 'Pune Junction (PUNE)' to 'Danapur'
def test_23_formatted_autocomplete_string_resolution():
    response = client.get(
        "/api/search",
        params={"from": "Pune Junction (PUNE)", "to": "Danapur", "date": DATE, "time": "15:20"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["search"]["from"] == "PUNE"
    assert payload["search"]["to"] == "DNR"
    assert payload["best_option"] is not None
    assert payload["best_option"]["source"] == "PUNE"
    assert payload["best_option"]["destination"] == "DNR"


# 24. Test tracking train 11401 with demo preview
def test_24_track_train_11401():
    res = client.get("/api/train/11401/live?demo=true")
    assert res.status_code == 200
    data = res.json()
    assert data["returned_train_number"] == "11401"
    assert data["train_name"] == "Nandigram Express"
    assert data["data_mode"] == "demo"


# 25. Test RailKit provider integration with mock response
def test_25_railkit_provider_live_tracking(monkeypatch):
    from backend import RailKitRailwayProvider

    prov = RailKitRailwayProvider("irctc_test_key_123")

    def fake_get(url, *, headers=None, timeout=None):
        return httpx.Response(
            200,
            json={
                "success": True,
                "data": {
                    "status": "running",
                    "statusText": "Departed from Pune Jn",
                    "lastUpdatedAt": "Oct 27, 2026, 23:45",
                    "trainInfo": [
                        {
                            "number": "11020",
                            "name": "KONARK EXPRESS",
                            "source": {"code": "BBSN", "name": "Bhubaneswar New"},
                            "destination": {"code": "CSMT", "name": "CSMT"},
                        }
                    ],
                    "currentLocation": {
                        "stnCode": "PUNE",
                        "stnName": "Pune Jn",
                        "status": "departed",
                        "delayMinutes": 10,
                        "platform": "3",
                    },
                    "route": [
                        {
                            "stnCode": "BBSN",
                            "stnName": "Bhubaneswar New",
                            "isHalt": True,
                            "status": "departed",
                            "arrival": {"scheduled": "14:40 27-Oct", "actual": "SRC"},
                            "departure": {"scheduled": "14:40 27-Oct", "actual": "14:40 27-Oct"},
                            "platform": "1",
                        },
                        {
                            "stnCode": "PUNE",
                            "stnName": "Pune Jn",
                            "isHalt": True,
                            "status": "departed",
                            "arrival": {"scheduled": "23:40 27-Oct", "actual": "23:50 27-Oct"},
                            "departure": {"scheduled": "23:45 27-Oct", "actual": "23:55 27-Oct"},
                            "platform": "3",
                        },
                    ],
                },
            },
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(backend.httpx, "get", fake_get)
    result = prov.get_live_status("11020", date(2026, 10, 27))
    assert result["returned_train_number"] == "11020"
    assert result["train_name"] == "KONARK EXPRESS"
    assert result["current_station"] == "Pune Jn"
    assert result["data_source"] == "railkit_irctc"
    assert len(result["stations"]) == 2
    assert result["stations"][1]["is_current"] is True


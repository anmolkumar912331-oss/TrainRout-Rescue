# TrainRoute Rescue

TrainRoute Rescue is a smart railway journey recovery web application that analyzes train delays, direct train availability, nearby stations, local/connecting trains and transfer feasibility to recommend the most practical route for a passenger when their original journey is disrupted.

**From missed train to the best possible next journey.**

This MVP is a responsive HTML/CSS/JavaScript frontend backed by FastAPI. It
intentionally uses clearly labelled Pune–Mumbai demo data; it does not connect
to a live railway provider and does not claim to show live status.

## Features

- Route search by source, destination, date, and current time.
- Priority-based recommendations: catchable delayed direct trains, upcoming
  direct trains, nearby-station connections, then local connectors.
- A 10-minute boarding buffer and a 20-minute transfer buffer; infeasible
  connections are rejected rather than shown as recommendations.
- Scenario selector for repeatable demonstrations and tests.
- Train detail lookup and explicit demo-only tracking status.
- Nearby station lookup, recent searches, and saved routes in browser storage.
- Responsive dashboard and accessible labels/status text.

## Run locally

Python 3.11 is recommended for the tested setup.

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python backend.py
```

Open <http://3.111.52.10:8000>. FastAPI's interactive API documentation is at
<http://3.111.52.10:8000/docs>. No separate Node.js frontend build is required.

Alternatively, run with Uvicorn:

```powershell
uvicorn backend:app --host 0.0.0.0 --port 8000 --reload
```

## API

- `GET /api/health`
- `GET /api/search?from=PUNE&to=MMCT&date=2026-10-08&time=15:20&scenario=all`
- `GET /api/stations/nearby?station=PUNE`
- `GET /api/train/{train_number}`
- `GET /api/train/{train_number}/live`
- `POST /api/routes/evaluate`

The search response includes `best_option`, `alternatives`, route groups,
warnings, search parameters, an update timestamp, and `data_mode: "demo"`.

## Data and security configuration

The default `DemoRailwayProvider` keeps the MVP usable without credentials.
For live train status, the backend can use the RapidAPI provider shown in the
project setup screenshots. Train tracking uses
`GET /api/trains/v1/train/status?departure_date=YYYYMMDD&train_number={number}&isH5=true&client=web`
at `indian-railway-irctc.p.rapidapi.com`. A separate
`/api/trains-search/v1/train/{number}` endpoint returns train timetable metadata,
not live running location, and is not used for tracking. Search schedules and route
recommendations remain demo data; only train-number status lookup uses the
provider. The adapter reads `body.train_status_message`, `body.current_station`,
and `body.stations` to find current and next stations; it does not infer GPS,
delay minutes, or a platform if the provider doesn't return them. Successful
status results are cached for 60 seconds to reduce quota usage. The live
tracking request accepts an optional `departure_date=YYYY-MM-DD`; by default it
uses the current date in India Standard Time.

Copy `.env.example` to `.env`, put a newly generated/replacement key in
`RAILWAY_API_KEY`, change `RAILWAY_PROVIDER=rapidapi`, then restart the backend.
The `.env` file is ignored by Git and must never be committed. The API key in
the shared screenshot was exposed: revoke it in RapidAPI and create a new key
before enabling live mode.

Set `CORS_ORIGINS` to a comma-separated list of trusted origins when hosting the
API separately. The default allows the AWS origin at
<http://3.111.52.10:8000>.

The backend reads `.env` on startup. Environment variables set in the process
take precedence according to `python-dotenv` defaults.

## Tests

```powershell
python -m pytest -q
```

See [docs/test-scenarios.md](./docs/test-scenarios.md) for the behaviors covered.

## Architecture and limitations

The browser requests recommendations from FastAPI. The backend validates
stations and date/time, requests normalized data from the demo provider, applies
boarding and transfer feasibility rules, and returns prioritized options.
Times are compared as `datetime` values, including next-day arrivals.

This prototype has no account system, server-side history database, AWS
deployment, or production authentication. Live tracking requires a working
RapidAPI subscription and server-side key; route-search timetable data remains
demo-only.
Search history and saved routes remain in the current browser. The route map is
an illustrative, non-live preview. AWS API Gateway, Lambda, and DynamoDB can be
added for a deployment version; they are not prerequisites for running this
college-project MVP.

## Future scope

Licensed live train status and platform data, persistent user accounts and
history, richer station/route coverage, mobile support, notifications,
multilingual assistance, fare comparison, and AWS deployment.

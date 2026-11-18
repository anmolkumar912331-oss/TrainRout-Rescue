# Route-engine demo scenarios

Run the automated scenarios with:

```powershell
python -m pytest -q
```

The UI's **Demo scenario** selector sends the following value as the `scenario`
query parameter to `GET /api/search`. All returned train times and statuses are
sample data, never live railway information.

| Scenario | Expected behavior |
| --- | --- |
| `all` | Catchable delayed direct is ranked first, followed by upcoming direct and feasible connecting routes. |
| `delayed_departed` | Reject the delayed service because the remaining boarding time is below the minimum buffer; continue to other routes. |
| `upcoming_only` | Recommend the earliest upcoming direct service without a delayed train. |
| `nearby_only` | Recommend Pune → Lonavala → Mumbai with a 30-minute transfer. |
| `tight_transfer` | Reject the 10-minute Lonavala transfer; never return it as a feasible option. |
| `local_connector` | Recommend the regional/local connector via Kalyan when no direct or nearby alternative is included. |
| `no_route` | Return an empty recommendation with an explicit no-feasible-route state. |

The suite also checks midnight rollover, station/date input validation,
connection station matching, and that train tracking reports demo status rather
than claiming live data.

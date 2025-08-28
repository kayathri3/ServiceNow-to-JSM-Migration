import requests
from requests.auth import HTTPBasicAuth

# Replace with your ServiceNow instance and credentials
instance = "dev331433"
username = "admin"
password = "Kayu@27889"

url = f"https://{instance}.service-now.com/api/now/table/incident"
params = {
    "sysparm_limit": "5",  # Number of incidents to fetch for this sample
    "sysparm_fields": "number,short_description,description,state,priority"
}

response = requests.get(
    url,
    auth=HTTPBasicAuth(username, password),
    headers={"Accept": "application/json"},
    params=params
)

resp_json = response.json()
if "result" in resp_json:
    incidents = resp_json["result"]
    for ticket in incidents:
        print(ticket)
else:
    print("Unexpected response:", resp_json)


# incidents = response.json()["result"]
# for ticket in incidents:
#     print(ticket)

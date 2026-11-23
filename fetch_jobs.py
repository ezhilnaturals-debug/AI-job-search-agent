
import json
import urllib.request
from datetime import datetime, timezone

KEYWORDS = [
    "supply chain", "procurement", "purchasing",
    "purchase order", "order management",
    "operations manager", "inventory",
    "logistics", "manufacturing", "planning",
    "vendor management", "sourcing",
    "supply chain manager"
]

jobs = []
seen = set()

def fetch(url, source):
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "AIJobFinder/1.0"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))

def add_job(job, source):
    title = job.get("title") or job.get("position") or ""
    company = job.get("company_name") or job.get("company") or ""
    description = job.get("description") or ""
    tags = job.get("tags") or []
    text = (title + " " + description + " " + " ".join(tags)).lower()

    if not any(word in text for word in KEYWORDS):
        return

    url = job.get("url") or job.get("apply_url") or job.get("apply_url")
    if not url:
        return

    if url in seen:
        return

    seen.add(url)

    jobs.append({
        "title": title,
        "company": company,
        "location": job.get("candidate_required_location")
                    or job.get("location") or "Remote / See listing",
        "salary": job.get("salary") or "",
        "date": job.get("publication_date")
                or job.get("date") or "",
        "description": description[:5000],
        "url": url,
        "source": source,
        "tags": tags
    })

# Source 1: Remotive
try:
    data = fetch(
        "https://remotive.com/api/remote-jobs",
        "Remotive"
    )
    for job in data.get("jobs", []):
        add_job(job, "Remotive")
except Exception as error:
    print("Remotive error:", error)

# Source 2: Remote OK
try:
    data = fetch("https://remoteok.com/api", "Remote OK")
    if isinstance(data, list):
        for job in data:
            if isinstance(job, dict) and job.get("position"):
                add_job(job, "Remote OK")
except Exception as error:
    print("Remote OK error:", error)

jobs.sort(key=lambda x: x["date"], reverse=True)

output = {
    "updated_at": datetime.now(timezone.utc).isoformat(),
    "total_jobs": len(jobs),
    "jobs": jobs
}

with open("jobs.json", "w", encoding="utf-8") as file:
    json.dump(output, file, ensure_ascii=False, indent=2)

print("Total relevant jobs collected:", len(jobs))

"""Collect job listings into jobs.json.

No keyword filtering happens here. The website filters and ranks jobs using
the visitor's CV and the filters they enter.
"""
import html
import json
import re
import urllib.request
from datetime import datetime, timezone

MAX_DESCRIPTION = 4000


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "AIJobFinder/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def clean_text(value):
    """HTML -> plain text, and repair text that was decoded with the wrong charset."""
    text = value or ""
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</h\d>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    if "\u00c3" in text or "\u00e2\u0080" in text:
        try:
            text = text.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def normalize(job, source):
    title = job.get("title") or job.get("position") or ""
    url = job.get("url") or job.get("apply_url") or ""
    if not title or not url:
        return None
    tags = job.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    return {
        "title": clean_text(title),
        "company": clean_text(job.get("company_name") or job.get("company") or ""),
        "location": clean_text(job.get("candidate_required_location") or job.get("location") or ""),
        "salary": job.get("salary") or "",
        "date": job.get("publication_date") or job.get("date") or "",
        "description": clean_text(job.get("description") or "")[:MAX_DESCRIPTION],
        "url": url,
        "source": source,
        "tags": [str(t) for t in tags],
    }


def collect():
    jobs, seen = [], set()

    def add_all(items, source):
        for item in items:
            if not isinstance(item, dict):
                continue
            job = normalize(item, source)
            if job and job["url"] not in seen:
                seen.add(job["url"])
                jobs.append(job)

    try:
        add_all(fetch("https://remotive.com/api/remote-jobs").get("jobs", []), "Remotive")
    except Exception as error:
        print("Remotive error:", error)

    try:
        data = fetch("https://remoteok.com/api")
        if isinstance(data, list):
            add_all([d for d in data if isinstance(d, dict) and d.get("position")], "Remote OK")
    except Exception as error:
        print("Remote OK error:", error)

    jobs.sort(key=lambda j: j["date"], reverse=True)
    return jobs


if __name__ == "__main__":
    jobs = collect()
    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total_jobs": len(jobs),
        "jobs": jobs,
    }
    with open("jobs.json", "w", encoding="utf-8") as file:
        json.dump(output, file, ensure_ascii=False, indent=2)
    print("Total jobs collected:", len(jobs))
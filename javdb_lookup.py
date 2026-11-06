#!/usr/bin/env python3
"""Look up a movie with the javdb package and emit one JSON object."""
import json
import sys

from javdb import Client


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        print("movie code is required", file=sys.stderr)
        return 2

    code = sys.argv[1].strip().upper()
    client = Client(timeout=15, retries=2)
    results = client.search(code, page=1, pages=1)
    if not results:
        return 3

    # The package selects exact IDs automatically; --first behavior is the
    # first result for a search that returns multiple matches.
    movie = client.movie(results[0]["link"])
    print(json.dumps(movie, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

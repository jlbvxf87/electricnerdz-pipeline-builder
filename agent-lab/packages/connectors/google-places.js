// Google Places API (New) connector — official, allowed, no scraping.
// Text Search for "{niche} in {city}" returns businesses with name + website + phone.
//
// Needs GOOGLE_PLACES_API_KEY. Free tier easily covers ~25 lookups/day.

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK =
  "places.id,places.displayName,places.websiteUri,places.nationalPhoneNumber,places.formattedAddress,places.rating,places.userRatingCount,nextPageToken";

async function searchBusinesses({ niche, city, apiKey, limit = 25, fetchImpl, delayMs = 0 } = {}) {
  const key = apiKey || process.env.GOOGLE_PLACES_API_KEY;
  const _fetch = fetchImpl || globalThis.fetch;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set.");
  if (!niche || !city) throw new Error("niche and city are required.");

  const textQuery = `${niche} in ${city}`;
  const results = [];
  let pageToken;

  do {
    const body = { textQuery, pageSize: 20, ...(pageToken ? { pageToken } : {}) };
    const res = await _fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);

    const data = await res.json();
    for (const p of data.places || []) {
      results.push({
        placeId: p.id,
        company: (p.displayName && p.displayName.text) || "",
        website: p.websiteUri || "",
        phone: p.nationalPhoneNumber || "",
        address: p.formattedAddress || "",
        rating: typeof p.rating === "number" ? p.rating : null,
        userRatingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
      });
      if (results.length >= limit) break;
    }

    pageToken = data.nextPageToken;
    // The New API needs a brief pause before a page token is valid.
    if (pageToken && results.length < limit && delayMs) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  } while (pageToken && results.length < limit);

  return results.slice(0, limit);
}

module.exports = { searchBusinesses };

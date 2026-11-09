import asyncio

import httpx

from app.main import app


async def post(path: str, payload: dict[str, object]) -> httpx.Response:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        return await client.post(path, json=payload)


def test_intent_extracts_audio_and_rupee_budget():
    response = asyncio.run(post("/v1/intent", {"query": "best audio speaker under ₹8,500"}))
    assert response.status_code == 200
    assert response.json()["category"] == "Audio"
    assert response.json()["budget_minor"] == 850_000
    assert response.json()["method"] == "deterministic_keyword_baseline"


def test_search_ranks_only_products_with_matching_terms():
    response = asyncio.run(post("/v1/search", {
        "query": "wireless speaker",
        "products": [
            {"id": "speaker", "name": "Ember speaker", "category": "Audio", "price_minor": 800000},
            {"id": "lamp", "name": "Arc table light", "category": "Home", "price_minor": 1200000},
        ],
    }))
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == ["speaker"]


def test_sentiment_returns_explanatory_lexicon_hits():
    response = asyncio.run(post("/v1/reviews/sentiment", {"text": "Great quality, but it broke"}))
    assert response.status_code == 200
    assert response.json()["label"] == "mixed_or_neutral"
    assert response.json()["positive_hits"] == ["great", "quality"]
    assert response.json()["negative_hits"] == ["broke"]

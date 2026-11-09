import re
from collections import Counter
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(
    title="ShopSmart Intelligence API",
    version="0.1.0",
    description="Transparent deterministic baselines; not a trained or semantic AI model.",
)

CATEGORY_TERMS = {
    "Audio": {"audio", "headphones", "headphone", "speaker", "sound", "music", "turntable", "record"},
    "Home": {"home", "lamp", "chair", "living", "interior", "table", "decor"},
    "Photography": {"camera", "photography", "photo", "lens", "camera bag"},
    "Accessories": {"watch", "accessory", "accessories"},
}
STOP_WORDS = {
    "a", "an", "and", "are", "best", "by", "for", "find", "good", "i", "in",
    "is", "it", "looking", "me", "my", "of", "on", "or", "the", "to", "under",
    "with", "you",
}
POSITIVE = {"beautiful", "comfortable", "excellent", "great", "love", "perfect", "quality", "recommend", "solid", "value"}
NEGATIVE = {"bad", "broke", "broken", "cheap", "disappointed", "issue", "poor", "returned", "slow", "uncomfortable", "worse"}


class IntentRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)


class IntentResponse(BaseModel):
    category: str | None
    budget_minor: int | None
    terms: list[str]
    method: Literal["deterministic_keyword_baseline"] = "deterministic_keyword_baseline"


class CatalogProduct(BaseModel):
    id: str
    name: str = Field(max_length=200)
    category: str = Field(max_length=80)
    description: str = Field(default="", max_length=1000)
    price_minor: int = Field(ge=0)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    products: list[CatalogProduct] = Field(max_length=200)
    limit: int = Field(default=10, ge=1, le=50)


class RankedProduct(BaseModel):
    id: str
    score: float
    matched_terms: list[str]


class SentimentRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class SentimentResponse(BaseModel):
    label: Literal["positive", "negative", "mixed_or_neutral"]
    positive_hits: list[str]
    negative_hits: list[str]
    method: Literal["transparent_lexicon_baseline"] = "transparent_lexicon_baseline"


def extract_terms(text: str) -> list[str]:
    return [word for word in re.findall(r"[a-z0-9]+", text.lower()) if word not in STOP_WORDS and len(word) > 1]


def parse_budget_minor(text: str) -> int | None:
    match = re.search(r"(?:₹\s*|rs\.?\s*|inr\s*)([\d,]+)", text.lower())
    if match is None:
        match = re.search(r"(?:under|below|budget(?:\s+of)?)\s+₹?\s*([\d,]+)", text.lower())
    if match is None:
        return None
    amount_rupees = int(match.group(1).replace(",", ""))
    return amount_rupees * 100


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/intent", response_model=IntentResponse)
def intent(payload: IntentRequest) -> IntentResponse:
    lowered = payload.query.lower()
    category = next(
        (name for name, terms in CATEGORY_TERMS.items() if any(term in lowered for term in terms)),
        None,
    )
    return IntentResponse(category=category, budget_minor=parse_budget_minor(payload.query), terms=extract_terms(payload.query))


@app.post("/v1/search", response_model=list[RankedProduct])
def search(payload: SearchRequest) -> list[RankedProduct]:
    query_terms = set(extract_terms(payload.query))
    results: list[RankedProduct] = []
    for product in payload.products:
        product_terms = set(extract_terms(f"{product.name} {product.category} {product.description}"))
        matched = sorted(query_terms & product_terms)
        if matched:
            results.append(RankedProduct(id=product.id, score=round(len(matched) / max(len(query_terms), 1), 4), matched_terms=matched))
    results.sort(key=lambda product: (-product.score, product.id))
    return results[: payload.limit]


@app.post("/v1/reviews/sentiment", response_model=SentimentResponse)
def review_sentiment(payload: SentimentRequest) -> SentimentResponse:
    tokens = set(extract_terms(payload.text))
    positive_hits = sorted(tokens & POSITIVE)
    negative_hits = sorted(tokens & NEGATIVE)
    if positive_hits and not negative_hits:
        label = "positive"
    elif negative_hits and not positive_hits:
        label = "negative"
    else:
        label = "mixed_or_neutral"
    return SentimentResponse(label=label, positive_hits=positive_hits, negative_hits=negative_hits)

#!/usr/bin/env python3
"""
Scraper de Vinted para GitHub Pages.

- Extrae: imagen, titulo, precio y enlace.
- Guarda hasta 10 productos en productos.json.
- Usa cloudscraper cuando esta disponible (fallback a requests).

Variable de entorno esperada:
  VINTED_PROFILE_URL
"""

from __future__ import annotations

import json
import os
import random
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

try:
    import cloudscraper  # type: ignore
except Exception:
    cloudscraper = None


MAX_ITEMS_PER_SOURCE = 10
OUTPUT_FILE = Path(__file__).resolve().with_name("productos.json")

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0",
]

# Selectores faciles de mantener/cambiar.
SELECTORS: dict[str, dict[str, list[str]]] = {
    "vinted": {
        "item": [
            "div.feed-grid__item",
            "article.feed-grid__item",
            "div.new-item-box",
            "article[data-testid='item-card']",
            "a[href*='/items/']",
        ],
        "title": [
            "[data-testid='item-title']",
            ".new-item-box__title",
            "h3",
            "h2",
            "a[title]",
        ],
        "price": [
            "[data-testid='item-price']",
            ".new-item-box__price",
            ".web_ui__Text__text",
            "[class*='price']",
        ],
        "image": [
            "img",
        ],
        "link": [
            "a[href*='/items/']",
            "a[href]",
        ],
    },
}


def clean_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def absolute_url(base_url: str, maybe_relative: str | None) -> str:
    raw = clean_text(maybe_relative)
    if not raw:
        return ""
    return urljoin(base_url, raw)


def image_from_tag(tag: Any, base_url: str) -> str:
    if not tag:
        return ""

    for attr in ("src", "data-src", "data-original"):
        src = clean_text(tag.get(attr))
        if src:
            return absolute_url(base_url, src)

    srcset = clean_text(tag.get("srcset"))
    if srcset:
        first = srcset.split(",")[0].strip().split(" ")[0]
        if first:
            return absolute_url(base_url, first)
    return ""


def first_text(container: Any, selectors: list[str]) -> str:
    for selector in selectors:
        element = container.select_one(selector)
        if not element:
            continue
        text = clean_text(element.get_text(" ", strip=True))
        if text:
            return text
        attr_title = clean_text(element.get("title"))
        if attr_title:
            return attr_title
    return ""


def first_href(container: Any, selectors: list[str], base_url: str) -> str:
    for selector in selectors:
        element = container.select_one(selector)
        if not element:
            continue
        href = absolute_url(base_url, element.get("href"))
        if href:
            return href

    href = absolute_url(base_url, container.get("href"))
    if href:
        return href
    return ""


def first_image(container: Any, selectors: list[str], base_url: str) -> str:
    for selector in selectors:
        element = container.select_one(selector)
        image = image_from_tag(element, base_url)
        if image:
            return image
    return ""


def jsonld_to_products(soup: BeautifulSoup, source: str, base_url: str, limit: int) -> list[dict[str, str]]:
    products: list[dict[str, str]] = []
    seen_links: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for child in node:
                walk(child)
            return

        if not isinstance(node, dict):
            return

        node_type = str(node.get("@type", "")).lower()
        if node_type in {"product", "offer"} or "product" in node_type:
            title = clean_text(node.get("name"))
            link = absolute_url(base_url, node.get("url"))
            image_value = node.get("image")
            image = ""
            if isinstance(image_value, list) and image_value:
                image = absolute_url(base_url, str(image_value[0]))
            elif isinstance(image_value, str):
                image = absolute_url(base_url, image_value)

            price = ""
            offers = node.get("offers")
            if isinstance(offers, dict):
                price = clean_text(str(offers.get("price", "")))
                currency = clean_text(str(offers.get("priceCurrency", "")))
                if price and currency:
                    price = f"{price} {currency}"

            if title and link and link not in seen_links:
                seen_links.add(link)
                products.append(
                    {
                        "source": source,
                        "title": title,
                        "price": price,
                        "image": image,
                        "link": link,
                    }
                )
                if len(products) >= limit:
                    return

        for value in node.values():
            walk(value)

    scripts = soup.select("script[type='application/ld+json']")
    for script in scripts:
        raw = clean_text(script.string or script.get_text())
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        walk(parsed)
        if len(products) >= limit:
            break

    return products[:limit]


def selector_to_products(soup: BeautifulSoup, source: str, base_url: str, limit: int) -> list[dict[str, str]]:
    cfg = SELECTORS[source]

    cards: list[Any] = []
    for selector in cfg["item"]:
        found = soup.select(selector)
        if len(found) > len(cards):
            cards = found
        if len(cards) >= limit:
            break

    products: list[dict[str, str]] = []
    seen_links: set[str] = set()
    for card in cards:
        link = first_href(card, cfg["link"], base_url)
        if not link or link in seen_links:
            continue

        title = first_text(card, cfg["title"])
        price = first_text(card, cfg["price"])
        image = first_image(card, cfg["image"], base_url)

        if not title:
            title = clean_text(card.get("title"))
        if not title:
            continue

        seen_links.add(link)
        products.append(
            {
                "source": source,
                "title": title,
                "price": price,
                "image": image,
                "link": link,
            }
        )

        if len(products) >= limit:
            break

    return products[:limit]


def fetch_html(url: str) -> str:
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }

    clients: list[tuple[str, Any]] = []
    if cloudscraper is not None:
        try:
            clients.append(("cloudscraper", cloudscraper.create_scraper()))
        except Exception:
            pass
    clients.append(("requests", requests.Session()))

    errors: list[str] = []
    for name, client in clients:
        try:
            response = client.get(url, headers=headers, timeout=25)
            response.raise_for_status()
            return response.text
        except Exception as exc:
            errors.append(f"{name}: {exc}")
    raise RuntimeError("No se pudo descargar la pagina. " + " | ".join(errors))


def scrape_profile(source: str, profile_url: str, limit: int = MAX_ITEMS_PER_SOURCE) -> list[dict[str, str]]:
    if not profile_url:
        print(f"[{source}] URL no configurada, se omite.")
        return []

    print(f"[{source}] Descargando perfil: {profile_url}")
    html = fetch_html(profile_url)
    soup = BeautifulSoup(html, "html.parser")

    by_selector = selector_to_products(soup, source, profile_url, limit)
    by_jsonld = jsonld_to_products(soup, source, profile_url, limit)

    combined: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in by_selector + by_jsonld:
        link = item.get("link", "")
        if not link or link in seen:
            continue
        seen.add(link)
        combined.append(item)
        if len(combined) >= limit:
            break

    print(f"[{source}] Productos extraidos: {len(combined)}")
    return combined


def build_payload(vinted_items: list[dict[str, str]]) -> dict[str, Any]:
    items = vinted_items
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_items": len(items),
        "items": items,
        "sources": {
            "vinted": {
                "profile_url": os.getenv("VINTED_PROFILE_URL", ""),
                "count": len(vinted_items),
            },
        },
    }


def main() -> int:
    vinted_url = clean_text(os.getenv("VINTED_PROFILE_URL", ""))

    vinted_items = scrape_profile("vinted", vinted_url, MAX_ITEMS_PER_SOURCE)

    payload = build_payload(vinted_items)
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"JSON actualizado en: {OUTPUT_FILE}")
    print(f"Total productos: {payload['total_items']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

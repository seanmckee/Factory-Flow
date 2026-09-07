"""Answer-checking primitives — pure text matching, no LLM judge.

The agent answers in prose ("Run #59 netted $19,993.00"), so correctness is
"does the required fact appear", tolerant of formatting: commas, dollar signs,
'#' prefixes, case. Deliberately not fuzzier than that — a judge model can be
layered on later, but the basic suite should fail loudly and cheaply.
"""

import re


def normalize(text: str) -> str:
    """Lowercase and strip the formatting prose puts on numbers."""
    return text.lower().replace(",", "").replace("$", "").replace("#", "")


def mentions_number(answer: str, value: float | str) -> bool:
    """True when `value` appears as a standalone number (not inside another),
    after normalization. `12` matches "12 runs", "#12" and "12." (a sentence
    ending), but not "120" or the 3 in "3.5"."""
    pattern = rf"(?<![\d.]){re.escape(str(value))}(?!\.?\d)"
    return re.search(pattern, normalize(answer)) is not None


def mentions_dollars(answer: str, cents: int) -> bool:
    """True when the amount appears in any of the shapes prose uses: exact
    cents ("19993.00"), whole dollars ("19993"), or raw cents ("1999300").
    Sign is not enforced — the phrasing carries it ("a loss of $506.27")."""
    magnitude = abs(cents)
    forms = {
        f"{magnitude // 100}.{magnitude % 100:02d}",
        str(magnitude // 100),
        str(magnitude),
    }
    return any(mentions_number(answer, form) for form in forms)


def mentions_text(answer: str, needle: str) -> bool:
    return normalize(needle) in normalize(answer)


def mentions_any(answer: str, needles: list[str]) -> bool:
    return any(mentions_text(answer, needle) for needle in needles)

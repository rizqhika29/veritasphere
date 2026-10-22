# Shared mock pages + LLM builders for Veritasphere direct tests.
# Pages are >= 400 chars (completeness gate) and contain every token the
# summaries/claims below are allowed to reference (binding + quote gates).
import json

GOOD_URL = "https://en.wikipedia.org/wiki/Bitcoin"
GOOD_URL_2 = "https://docs.genlayer.com/developers/intelligent-contracts/ideas"
SPAM_URL = "https://spam-farm-xyz.example/free-money"

GOOD_PAGE = (
    "Bitcoin is a decentralized digital currency. "
    "It was invented in 2008 by Satoshi Nakamoto. "
    "Transactions are verified by network nodes through cryptography. "
    "The public ledger that records every transfer is called a blockchain, "
    "and participants who maintain it are known as miners. "
    "A bitcoin divides into one hundred million smaller units called satoshis. "
    "No central bank or government issues new bitcoins; the protocol itself "
    "controls issuance according to rules agreed by the network participants. "
    "Because the ledger is public, anyone can audit the history of transfers."
)

SPAM_PAGE = (
    "FREE MONEY CLICK HERE jackpot casino bonus!!! "
    "Make money fast with guaranteed returns and no risk. "
    "Act now to claim your prize before the offer expires today. "
    "This is a promotional landing page stuffed with repeated keywords and "
    "carries no factual content about any topic whatsoever. "
    "Sign up immediately for free money offers that promise unrealistic "
    "profits without any evidence, disclosure, or verifiable source."
)

ACCEPT_SUMMARY = (
    "Bitcoin is a decentralized digital currency invented in 2008 by "
    "Satoshi Nakamoto, with transactions verified by network nodes."
)


def accept_llm(summary=ACCEPT_SUMMARY, score=9):
    """Happy-path verdict: relevant, accurate, claims quoted from GOOD_PAGE."""
    return json.dumps({
        "summary": summary,
        "score": score,
        "is_relevant": True,
        "contributor_accurate": True,
        "claims": [
            {
                "claim": "Bitcoin is a decentralized digital currency",
                "support_quote": "Bitcoin is a decentralized digital currency",
            },
            {
                "claim": "Bitcoin was invented in 2008 by Satoshi Nakamoto",
                "support_quote": "invented in 2008 by Satoshi Nakamoto",
            },
        ],
        "reason": "reputable source, faithful summary",
    })


def reject_llm(score=2):
    """Spam verdict: irrelevant source, claims quoted from SPAM_PAGE."""
    return json.dumps({
        "summary": "Free money click here jackpot bonus casino promotion without any verifiable facts.",
        "score": score,
        "is_relevant": False,
        "contributor_accurate": True,
        "claims": [
            {
                "claim": "The page promises free money with casino bonuses",
                "support_quote": "FREE MONEY CLICK HERE jackpot casino bonus",
            },
            {
                "claim": "The page claims guaranteed returns without risk",
                "support_quote": "guaranteed returns and no risk",
            },
        ],
        "reason": "spam source, no verifiable facts",
    })


def mock_good_web(direct_vm, page=GOOD_PAGE):
    direct_vm.mock_web(r".*wikipedia\.org/wiki/Bitcoin.*", {"status": 200, "body": page})


def mock_good_llm(direct_vm, response=None):
    direct_vm.mock_llm(r".*Veritasphere truth validator.*", response or accept_llm())

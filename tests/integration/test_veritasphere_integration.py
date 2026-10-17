"""
Veritasphere integration tests — full consensus (leader + validators).
Run: gltest tests/integration/test_veritasphere_integration.py -v -s --network studionet
Requires real web + LLM, so use GOOD sources only for accuracy.
"""
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

# Good sources = stable, reputable, text-rich. Avoid spam/JS-heavy pages.
GOOD_URL = "https://en.wikipedia.org/wiki/Bitcoin"
GOOD_TITLE = "What is Bitcoin?"
GOOD_DRAFT = "Bitcoin is a decentralized digital currency invented by Satoshi Nakamoto, transactions verified by network nodes. This draft is long enough to pass submission gate."


def test_full_accept_flow():
    factory = get_contract_factory("Veritasphere")
    contract = factory.deploy(args=[0])

    tx = contract.submit_contribution(
        args=["crypto", GOOD_TITLE, GOOD_URL, GOOD_DRAFT]
    ).transact()
    assert tx_execution_succeeded(tx), f"submit failed: {tx}"

    # entry 1 must be PENDING and readable from frontend
    entry = contract.get_entry(args=[1]).call()
    assert entry["status"] == "PENDING"
    assert entry["source_url"] == GOOD_URL

    pending = contract.get_pending_entries().call()
    assert len(pending) >= 1

    # full consensus: leader fetches GOOD_URL + LLM scores, validators re-fetch + compare
    tx2 = contract.validate_contribution(args=[1]).transact()
    assert tx_execution_succeeded(tx2), f"validate failed: {tx2}"

    # AI consensus result must be readable via dedicated frontend view
    v = contract.get_validation_result(args=[1]).call()
    # v contains: status, ai_score, ai_summary, ai_reason, accepted, threshold, source_url
    assert v["status"] in ("ACCEPTED", "REJECTED"), f"unexpected: {v}"
    assert v["threshold"] == 7
    assert len(v["ai_summary"]) >= 20
    assert v["source_url"] == GOOD_URL
    print(f"CONSENSUS RESULT: {v['status']} score={v['ai_score']} reason={v['ai_reason']}")

    # frontend list views
    all_entries = contract.get_all_entries(args=[1, 10]).call()
    assert all_entries["total"] >= 1

    topics = contract.get_topics().call()
    assert "crypto" in topics

    by_topic = contract.get_accepted_entries(args=["crypto", 10]).call()
    # if accepted, must appear here; if rejected (low score), list may be empty — both valid
    # but consensus must be deterministic: re-read must match
    v2 = contract.get_validation_result(args=[1]).call()
    assert v2 == v


def test_reject_flow_does_not_break_reads():
    factory = get_contract_factory("Veritasphere")
    contract = factory.deploy(args=[0])

    tx = contract.submit_contribution(
        args=["spam-test", "Free money", "https://example.com/", "This is a thin low quality draft that should be rejected by AI consensus scoring."]
    ).transact()
    assert tx_execution_succeeded(tx)

    tx2 = contract.validate_contribution(args=[1]).transact()
    assert tx_execution_succeeded(tx2)

    v = contract.get_validation_result(args=[1]).call()
    assert v["status"] in ("ACCEPTED", "REJECTED")
    # leaderboard + stats must always be readable
    lb = contract.get_leaderboard(args=[10]).call()
    assert isinstance(lb, list)
    stats = contract.get_stats().call()
    assert stats["total_entries"] >= 1

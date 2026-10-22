import pytest

from _mocks import (
    GOOD_URL, GOOD_URL_2, SPAM_URL, GOOD_PAGE, SPAM_PAGE,
    accept_llm, reject_llm, mock_good_web, mock_good_llm,
)

CONTRACT = "contracts/veritasphere.py"

DRAFT = "Bitcoin is a decentralized currency invented by Satoshi, need validation here for test."


def test_submit_and_read(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)

    eid = contract.submit_contribution("crypto", "What is Bitcoin?", GOOD_URL, DRAFT)
    assert int(eid) == 1

    entry = contract.get_entry(1)
    assert entry["topic"] == "crypto"
    assert entry["status"] == "PENDING"
    assert entry["source_url"] == GOOD_URL
    assert entry["committed_reward"] == "0"

    v = contract.get_validation_result(1)
    assert v["status"] == "PENDING"
    assert v["accepted"] is False
    assert v["threshold"] == 7

    pending = contract.get_pending_entries(0, 20)
    assert pending["total"] == 1
    assert pending["entries"][0]["id"] == 1

    topics = contract.get_topics()
    assert "crypto" in topics

    stats = contract.get_stats()
    assert stats["total_entries"] == 1
    assert stats["name"] == "Veritasphere"
    assert stats["pending_count"] == 1
    assert stats["pool_balance"] == "0"
    assert stats["reserved_balance"] == "0"
    assert stats["available_balance"] == "0"


def test_duplicate_and_bad_url_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)

    contract.submit_contribution("ai", "GenLayer ideas", GOOD_URL_2, "GenLayer supports crowdsourced knowledge database idea with rewards, long enough summary.")

    with direct_vm.expect_revert("already submitted"):
        contract.submit_contribution("ai", "Duplicate", GOOD_URL_2, "Another long enough summary that should still be rejected as duplicate source.")

    # steward: HTTPS-only sources
    with direct_vm.expect_revert("must start with https://"):
        contract.submit_contribution("ai", "Bad", "ftp://bad-url", "Long enough summary to pass length check but bad url scheme.")

    with direct_vm.expect_revert("must start with https://"):
        contract.submit_contribution("ai", "PlainHttp", "http://example.com/x", "Long enough summary to pass length check but plain http scheme.")

    with direct_vm.expect_revert("min 20 chars"):
        contract.submit_contribution("ai", "Short", GOOD_URL, "too short")


def test_validate_accept_good_source(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)

    contract.submit_contribution("crypto", "Bitcoin", GOOD_URL, "Contributor draft about bitcoin long enough for submission gate.")

    mock_good_web(direct_vm)
    mock_good_llm(direct_vm)

    result = contract.validate_contribution(1)
    assert "ACCEPTED" in str(result)

    entry = contract.get_entry(1)
    assert entry["status"] == "ACCEPTED"
    assert entry["score"] == 9
    assert len(entry["summary"]) >= 20
    # steward: verifiable evidence commitment recorded at settlement
    assert entry["evidence_hash"].startswith("0x")
    assert entry["evidence_len"] > 400
    assert entry["evidence_truncated"] is False

    v = contract.get_validation_result(1)
    assert v["accepted"] is True
    assert v["ai_score"] == 9

    acc = contract.get_accepted_entries("crypto", 0, 10)
    assert acc["total"] == 1
    assert acc["entries"][0]["id"] == 1

    lb = contract.get_leaderboard(0, 10)
    assert lb["entries"][0]["accepted"] == 1
    assert lb["entries"][0]["submitted"] == 1

    # pending registry must be empty after settlement
    assert contract.get_pending_entries(0, 20)["total"] == 0


def test_validate_reject_spam_source(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)

    contract.submit_contribution("crypto", "Free money", SPAM_URL, "Contributor claims free money jackpot here, long enough draft text.")

    direct_vm.mock_web(r".*spam-farm-xyz.*", {"status": 200, "body": SPAM_PAGE})
    direct_vm.mock_llm(r".*Veritasphere truth validator.*", reject_llm())

    result = contract.validate_contribution(1)
    assert "REJECTED" in str(result)

    entry = contract.get_entry(1)
    assert entry["status"] == "REJECTED"

    # rejected must not appear in accepted list, still gone from pending
    assert contract.get_accepted_entries("", 0, 10) == {"total": 0, "entries": []}
    assert contract.get_pending_entries(0, 20) == {"total": 0, "entries": []}


def test_double_validate_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    contract.submit_contribution("ai", "Topic", GOOD_URL, "Long enough contributor draft summary for double validate test.")

    mock_good_web(direct_vm)
    mock_good_llm(direct_vm)
    contract.validate_contribution(1)

    with direct_vm.expect_revert("already"):
        contract.validate_contribution(1)


def test_frontend_pagination_and_leaderboard(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)

    direct_vm.sender = direct_alice
    contract.submit_contribution("ai", "A1", GOOD_URL, "Alice first contribution draft summary long enough text here.")
    direct_vm.sender = direct_bob
    contract.submit_contribution("ai", "B1", GOOD_URL_2, "Bob first contribution draft summary long enough text here.")

    page = contract.get_all_entries(1, 10)
    assert page["total"] == 2
    assert len(page["entries"]) == 2

    page1 = contract.get_all_entries(1, 1)
    assert len(page1["entries"]) == 1
    assert page1["entries"][0]["id"] == 1

    lb = contract.get_leaderboard(0, 10)
    assert lb["total"] == 2
    assert len(lb["entries"]) == 2
    assert sum(r["submitted"] for r in lb["entries"]) == 2

    by_topic = contract.get_entries_by_topic("ai", 0, 10)
    assert by_topic["total"] == 2
    assert len(by_topic["entries"]) == 2


def test_access_control(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only owner"):
        contract.set_reward_amount(100)

    with direct_vm.expect_revert("Only owner"):
        contract.withdraw(1, str(direct_bob))

    direct_vm.sender = direct_alice
    contract.set_reward_amount(500)
    assert contract.get_stats()["reward_amount"] == "500"


def test_llm_resilience_short_summary(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    contract.submit_contribution("ai", "T", GOOD_URL, "Long enough draft summary for resilience test case here.")

    mock_good_web(direct_vm)
    bad_llm = accept_llm(summary="x")
    direct_vm.mock_llm(r".*Veritasphere.*", bad_llm)

    with direct_vm.expect_revert("too short"):
        contract.validate_contribution(1)

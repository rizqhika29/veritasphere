import json
import pytest

CONTRACT = "contracts/veritasphere.py"
GOOD_URL = "https://en.wikipedia.org/wiki/Bitcoin"
GOOD_URL_2 = "https://docs.genlayer.com/developers/intelligent-contracts/ideas"
SPAM_URL = "https://spam-farm-xyz.example/free-money"

GOOD_PAGE = "Bitcoin is a decentralized digital currency. It was invented in 2008 by Satoshi Nakamoto. Transactions are verified by network nodes through cryptography."
SPAM_PAGE = "FREE MONEY CLICK HERE jackpot casino bonus!!!"

ACCEPT_LLM = json.dumps({
    "summary": "Bitcoin is a decentralized digital currency invented in 2008 by Satoshi Nakamoto, with transactions verified by network nodes.",
    "score": 9,
    "is_relevant": True,
    "reason": "reputable source, faithful summary, novel fact"
})

REJECT_LLM = json.dumps({
    "summary": "Free money click here jackpot bonus casino.",
    "score": 2,
    "is_relevant": False,
    "reason": "spam source, no verifiable facts"
})


def _deploy_with_owner(direct_vm, direct_deploy, owner, reward=0):
    contract = direct_deploy(CONTRACT, args=[reward])
    # direct_deploy uses current sender as deployer; ensure owner is sender
    return contract


def test_submit_and_read(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)

    eid = contract.submit_contribution(
        "crypto",
        "What is Bitcoin?",
        GOOD_URL,
        "Bitcoin is a decentralized currency invented by Satoshi, need validation here for test.",
    )
    assert int(eid) == 1

    entry = contract.get_entry(1)
    assert entry["topic"] == "crypto"
    assert entry["status"] == "PENDING"
    assert entry["source_url"] == GOOD_URL

    # frontend reads must work pre-validation
    v = contract.get_validation_result(1)
    assert v["status"] == "PENDING"
    assert v["accepted"] is False
    assert v["threshold"] == 7

    pending = contract.get_pending_entries()
    assert len(pending) == 1
    assert pending[0]["id"] == 1

    topics = contract.get_topics()
    assert "crypto" in topics

    stats = contract.get_stats()
    assert stats["total_entries"] == 1
    assert stats["name"] == "Veritasphere"


def test_duplicate_and_bad_url_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)

    contract.submit_contribution("ai", "GenLayer ideas", GOOD_URL_2, "GenLayer supports crowdsourced knowledge database idea with rewards, long enough summary.")

    with direct_vm.expect_revert("already submitted"):
        contract.submit_contribution("ai", "Duplicate", GOOD_URL_2, "Another long enough summary that should still be rejected as duplicate source.")

    with direct_vm.expect_revert("must start with http"):
        contract.submit_contribution("ai", "Bad", "ftp://bad-url", "Long enough summary to pass length check but bad url scheme.")

    with direct_vm.expect_revert("min 20 chars"):
        contract.submit_contribution("ai", "Short", GOOD_URL, "too short")


def test_validate_accept_good_source(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)

    contract.submit_contribution("crypto", "Bitcoin", GOOD_URL, "Contributor draft about bitcoin long enough for submission gate.")

    direct_vm.mock_web(r".*wikipedia\.org/wiki/Bitcoin.*", {"status": 200, "body": GOOD_PAGE})
    direct_vm.mock_llm(r".*Veritasphere truth validator.*", ACCEPT_LLM)

    result = contract.validate_contribution(1)
    assert "ACCEPTED" in str(result)

    entry = contract.get_entry(1)
    assert entry["status"] == "ACCEPTED"
    assert entry["score"] == 9
    assert len(entry["summary"]) >= 20

    v = contract.get_validation_result(1)
    assert v["accepted"] is True
    assert v["ai_score"] == 9

    acc = contract.get_accepted_entries("crypto", 10)
    assert len(acc) == 1
    assert acc[0]["id"] == 1

    lb = contract.get_leaderboard(10)
    assert lb[0]["accepted"] == 1
    assert lb[0]["submitted"] == 1


def test_validate_reject_spam_source(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)

    contract.submit_contribution("crypto", "Free money", SPAM_URL, "Contributor claims free money jackpot here, long enough draft text.")

    direct_vm.mock_web(r".*spam-farm-xyz.*", {"status": 200, "body": SPAM_PAGE})
    direct_vm.mock_llm(r".*Veritasphere truth validator.*", REJECT_LLM)

    result = contract.validate_contribution(1)
    assert "REJECTED" in str(result)

    entry = contract.get_entry(1)
    assert entry["status"] == "REJECTED"

    # rejected must not appear in accepted list, still gone from pending
    assert contract.get_accepted_entries("", 10) == []
    assert contract.get_pending_entries() == []


def test_double_validate_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    contract.submit_contribution("ai", "Topic", GOOD_URL, "Long enough contributor draft summary for double validate test.")

    direct_vm.mock_web(r".*wikipedia.*", {"status": 200, "body": GOOD_PAGE})
    direct_vm.mock_llm(r".*Veritasphere.*", ACCEPT_LLM)
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

    lb = contract.get_leaderboard(10)
    assert len(lb) == 2
    # both submitted 1, accepted 0 -> order stable
    assert sum(r["submitted"] for r in lb) == 2


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

    direct_vm.mock_web(r".*wikipedia.*", {"status": 200, "body": GOOD_PAGE})
    bad_llm = json.dumps({"summary": "x", "score": 9, "is_relevant": True, "reason": "too short"})
    direct_vm.mock_llm(r".*Veritasphere.*", bad_llm)

    with direct_vm.expect_revert("too short"):
        contract.validate_contribution(1)

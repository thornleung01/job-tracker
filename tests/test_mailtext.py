"""The text of a stored email, made readable. Samples are the shapes of real mail that looked bad."""
import re

import pytest

from jobtracker.mailtext import parts, render, split_sender

# A reply from Outlook: lines broken mid-sentence, a bullet alone on its line, a quoted chain with the header split over lines.
DEEL = ("Hi Jordan,\nAt this time we don't provide RRSP match for folks in Canada.\xa0\nRegarding our other benefits, please see them below!\n-\n Team Member \n"
        "Referrals:\n you get a referral bonus if someone you refer is hired.\n- Customer Referral Policy\n: you can send business leads to Sales.\n"
        "- Flexible Time Off\n: 12 paid holidays\xa0+ up to 18 paid personal days\nBest,\nSam\n"
        "On Fri, Oct 23, 2026 at 4:49 PM Jordan Lee <\njordan.lee@outlook.com\n> wrote:\nEXT SENDER– Be cautious \nHi Samantha,\xa0\nThanks for sending this over.\n")

NEWSLETTER = ("Inside: Tesla SQL challenge, ML vs. AI vs. LLM roles, and AI's hype-vs-numbers problem  "
              "( https://platform.stratascratch.com/coding?code_type=1&page_size=100&utm_source=newsletter&utm_medium=email&utm_campaign=102026 )  "
              "*Platform Updates* " + "͏ " * 30 + "\n\nBuild confidence in your interview prep with new questions every week and a cohort of people preparing alongside you.\n\n"
              "This email was intended for Jordan Lee. Learn why we included this. You are receiving notification emails. Unsubscribe · Help © 2026 LinkedIn Corporation")


def text_of(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(html))).strip()


def test_lines_broken_mid_sentence_are_joined_and_glued_punctuation_is_repaired():
    main, thread, _ = parts(DEEL)
    joined = " | ".join(main)
    assert "Team Member Referrals:" in joined                                   # an inline tag had split it
    assert "Customer Referral Policy: you can send business leads to Sales." in joined
    assert "12 paid holidays + up to 18 paid personal days" in joined            # no-break space and a leading colon
    assert main[0] == "Hi Jordan," and "Best," in main                           # greeting and sign-off stay on their own lines


def test_the_reply_chain_is_folded_and_the_warning_banner_is_dropped():
    main, thread, _ = parts(DEEL)
    assert not any("wrote:" in b for b in main) and thread[0].endswith("wrote:")
    assert "On Fri, Oct 23, 2026 at 4:49 PM Jordan Lee < jordan.lee@outlook.com > wrote:" == thread[0]
    assert all("EXT SENDER" not in b for b in main + thread)
    html = str(render(DEEL))
    assert html.count("<details") == 1 and "Earlier in this thread" in html
    assert html.index("Earlier in this thread") > html.index("Flexible Time Off")        # the message first, the thread after


def test_list_items_become_a_list():
    html = str(render(DEEL))
    assert html.count("<ul>") == 1 and html.count("<li>") == 3


def test_links_show_their_domain_and_are_never_clickable():
    html = str(render(NEWSLETTER))
    assert 'class="url" title="https://platform.stratascratch.com/coding?' in html and ">platform.stratascratch.com</span>" in html
    assert "<a " not in html and "href=" not in html
    assert "utm_source" not in text_of(html)                                       # the tracking tail is in the tooltip only


def test_invisible_padding_and_the_footer_are_cleaned_up():
    main, _, footer = parts(NEWSLETTER)
    assert "͏" not in "".join(main + footer)
    assert any("Build confidence" in b for b in main) and not any("Unsubscribe" in b for b in main)
    assert footer and "Unsubscribe" in " ".join(footer)
    assert "Footer and links" in str(render(NEWSLETTER))


def test_a_view_online_line_at_the_top_is_not_mistaken_for_a_footer():
    main, _, footer = parts("Having trouble viewing? View this email online.\n\nWe would like to invite you to interview for the analyst role at Acme next week.")
    assert footer == [] and len(main) == 2


def test_everything_is_escaped():
    html = str(render("<script>alert(1)</script> hello\n\nSee https://evil.example.com/?x=\"><img src=x onerror=alert(1)> now"))
    assert "<script>" not in html and "<img" not in html and "&lt;script&gt;" in html
    assert 'onerror=alert(1)>' not in html.replace("&gt;", "")


def test_a_message_that_is_only_a_quote_is_not_folded_away():
    main, thread, _ = parts("> Hi there\n> thanks for applying")
    assert main and thread == []


def test_empty_and_missing_text_say_so():
    for empty in ("", None, "   \n  "):
        assert "No text was stored" in str(render(empty))


@pytest.mark.parametrize("raw,name,addr", [
    ("Pat Lee <pat@acme.com>", "Pat Lee", "pat@acme.com"),
    ('"Lee, Pat" <pat@acme.com>', "Lee, Pat", "pat@acme.com"),
    ("pat@acme.com <pat@acme.com>", "pat@acme.com", "pat@acme.com"),
    ("pat@acme.com", "", "pat@acme.com"),
    ("", "", ""),
])
def test_senders_split_into_name_and_address(raw, name, addr):
    assert split_sender(raw) == (name, addr)


OUTLOOK_HEADER = ("Thanks, talk soon!\nBest,\nJordan\nFrom:\nSamuel Okafor <sam.okafor@deel.com>\nSent:\nThursday, October 22, 2026 6:43 PM\n"
                  "To:\njordan.lee@outlook.com\nSubject:\nUpdate From Deel\nHi Jordan,\nThank you for taking the time to meet with Dan!")


def test_an_outlook_header_block_reads_one_field_per_line():
    main, thread, _ = parts("Thanks, talk soon!\nBest,\nJordan\nOn Thu, Oct 22, 2026 at 6:30 PM Jordan Lee <\njordan.lee@outlook.com\n> wrote:\n"
                            "Hi Sam,\nSee you then.\nBest,\nJordan\nFrom:\nSamuel Okafor <sam.okafor@deel.com>\nSent:\nThursday, October 22, 2026 6:43 PM\n"
                            "To:\njordan.lee@outlook.com\nSubject:\nUpdate From Deel\nHi Jordan,\nThank you!")
    assert "From: Samuel Okafor <sam.okafor@deel.com>" in thread
    assert "Sent: Thursday, October 22, 2026 6:43 PM" in thread and "To: jordan.lee@outlook.com" in thread and "Subject: Update From Deel" in thread
    assert "Jordan" in thread and not any(b.endswith(" From:") for b in thread)         # the sign-off no longer swallows the next header

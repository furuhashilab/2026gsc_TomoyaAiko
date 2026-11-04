import pytest

from circuitforge_gis.rules import classify_access, classify_direction, classify_way


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"highway": "residential", "oneway": "yes"}, "forward"),
        ({"highway": "residential", "oneway": "1"}, "forward"),
        ({"highway": "residential", "oneway": "-1"}, "reverse"),
        ({"highway": "residential", "oneway": "reverse"}, "reverse"),
        ({"highway": "residential", "oneway": "no"}, "both"),
        ({"highway": "residential"}, "both"),
        ({"highway": "tertiary", "junction": "roundabout"}, "forward"),
        ({"highway": "tertiary", "junction": "circular"}, "forward"),
        ({"highway": "motorway"}, "forward"),
        # Not a fixed direction: never treated as two-way.
        ({"highway": "residential", "oneway": "reversible"}, "uncertain"),
        ({"highway": "residential", "oneway": "alternating"}, "uncertain"),
        ({"highway": "residential", "oneway": "yes;no"}, "uncertain"),
        ({"highway": "residential", "oneway": "T"}, "uncertain"),
        ({"highway": "motorway_link"}, "uncertain"),
        # An explicit tag wins over the roundabout implication.
        ({"highway": "tertiary", "junction": "roundabout", "oneway": "no"}, "both"),
    ],
)
def test_direction(tags, expected):
    assert classify_direction(tags)[0] == expected


def test_untagged_two_way_records_its_basis():
    assert "OSM default" in classify_direction({"highway": "residential"})[1]


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({}, "untagged"),
        ({"access": "yes"}, "allowed"),
        ({"access": "private"}, "restricted"),
        ({"access": "no", "motorcar": "yes"}, "allowed"),  # most specific key wins
        ({"access": "yes", "motor_vehicle": "no"}, "restricted"),
        ({"vehicle": "no"}, "restricted"),
        ({"motor_vehicle": "destination"}, "needs_review"),
        ({"access": "permit"}, "needs_review"),
    ],
)
def test_access(tags, expected):
    assert classify_access(tags)[0] == expected


@pytest.mark.parametrize(
    "key",
    [
        "access:conditional",
        "motor_vehicle:conditional",
        "motorcar:conditional",
        "vehicle:conditional",
        "oneway:conditional",
        "motor_vehicle:forward",
        "oneway:motorcar",
    ],
)
def test_unhandled_restrictions_need_review_and_are_not_routable(key):
    r = classify_way({"highway": "residential", key: "no"})
    assert any(key in reason for reason in r.review)
    assert not r.routable


def test_other_mode_subkeys_are_ignored():
    r = classify_way({"highway": "residential", "oneway:bicycle": "no", "access:bus": "yes"})
    assert r.review == ()
    assert r.routable

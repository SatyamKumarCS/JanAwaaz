"""Python mirrors of the shared enums (packages/shared/enums.json is the source of truth)."""

from enum import StrEnum


class ComplaintStatus(StrEnum):
    SUBMITTED = "submitted"
    VERIFIED = "verified"
    ROUTED = "routed"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    REJECTED = "rejected"
    ESCALATED = "escalated"


class Category(StrEnum):
    ROADS = "roads"
    SANITATION = "sanitation"
    STREETLIGHTS = "streetlights"
    WATER_SUPPLY = "water_supply"
    DRAINAGE = "drainage"


class Priority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

-- Down migration: drop automation_rules and currencies tables

DROP TABLE IF EXISTS automation_rules;
DROP TABLE IF EXISTS currencies;

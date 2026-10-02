PRAGMA foreign_keys = ON;

CREATE TABLE people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#20b99a',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE years (
  year INTEGER PRIMARY KEY CHECK (year BETWEEN 2000 AND 2200),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL REFERENCES years(year) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES destinations(id),
  rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  person_id INTEGER REFERENCES people(id),
  CHECK (date_from <= date_to)
);

CREATE TABLE incomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL REFERENCES years(year) ON DELETE CASCADE,
  income_date TEXT NOT NULL,
  concept TEXT NOT NULL,
  person_id INTEGER NOT NULL REFERENCES people(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rules_year_dates ON rules(year, date_from, date_to);
CREATE INDEX idx_incomes_year_date ON incomes(year, income_date DESC);
CREATE INDEX idx_incomes_year_person ON incomes(year, person_id);

INSERT INTO people (id, name) VALUES (1, 'Dani'), (2, 'Marta');
INSERT INTO destinations (id, name, color, sort_order) VALUES
  (1, 'Común', '#20b99a', 1),
  (2, 'Ahorro', '#4a7ef0', 2),
  (3, 'Gonzalo', '#f1a24d', 3),
  (4, 'D', '#a16ae8', 4),
  (5, 'E', '#eb6ca4', 5),
  (6, 'F', '#6c8da5', 6);
INSERT INTO years (year) VALUES (2025), (2026);

INSERT INTO rules (year, destination_id, rate_bps, date_from, date_to, person_id) VALUES
  (2025, 1, 1800, '2025-02-01', '2025-05-15', NULL),
  (2025, 2, 700,  '2025-02-01', '2025-12-31', NULL),
  (2025, 1, 2100, '2025-05-15', '2025-12-31', NULL),
  (2026, 1, 2100, '2026-01-01', '2026-03-30', NULL),
  (2026, 2, 700,  '2026-01-01', '2026-04-30', NULL),
  (2026, 1, 2700, '2026-04-01', '2026-12-31', NULL),
  (2026, 2, 2500, '2026-05-01', '2026-06-08', NULL),
  (2026, 2, 700,  '2026-06-09', '2026-12-31', NULL),
  (2026, 2, 1800, '2026-06-09', '2026-09-04', 2),
  (2026, 3, 100,  '2026-07-01', '2026-12-31', NULL);

INSERT INTO incomes (year, income_date, concept, person_id, amount_cents) VALUES
  (2025, '2025-02-03', 'Nómina Enero', 1, 325155),
  (2025, '2025-02-03', 'Nómina Enero', 2, 220810),
  (2025, '2025-02-03', 'Extra Etanco', 2, 20000),
  (2025, '2025-02-26', 'Nómina Febrero', 1, 345941),
  (2025, '2025-02-27', 'Nómina Febrero', 2, 221123),
  (2025, '2025-02-27', 'Extra Etanco', 2, 20000),
  (2025, '2025-03-26', 'Nómina Marzo', 1, 324851),
  (2025, '2025-03-27', 'Nómina Marzo', 2, 221123),
  (2025, '2025-03-27', 'Extra Etanco', 2, 20000),
  (2025, '2025-04-28', 'Nómina Abril', 2, 221123),
  (2025, '2025-04-28', 'Nómina Abril', 1, 346004),
  (2025, '2025-04-27', 'Extra Etanco', 2, 20000),
  (2025, '2025-05-29', 'Nómina Mayo', 1, 346996),
  (2025, '2025-05-29', 'Nómina Mayo', 2, 221123),
  (2025, '2025-05-27', 'Extra Etanco', 2, 20000),
  (2025, '2025-06-26', 'Nómina Junio', 2, 222394),
  (2025, '2025-06-26', 'Nómina Junio', 1, 333289),
  (2025, '2025-06-26', 'Extra Etanco', 2, 20000),
  (2025, '2025-07-14', 'Paga extra julio', 2, 228792),
  (2025, '2025-07-30', 'Nómina Julio', 2, 232424),
  (2025, '2025-07-30', 'Extra Etanco', 2, 20000),
  (2025, '2025-07-29', 'Nómina Julio', 1, 325459),
  (2025, '2025-08-27', 'Nómina Agosto', 1, 411853),
  (2025, '2025-08-28', 'Nómina agosto', 2, 224776),
  (2025, '2025-08-28', 'Extra Etanco', 2, 20000),
  (2025, '2025-09-28', 'Nómina Septiembre', 1, 346527),
  (2025, '2025-09-29', 'Nómina Septiembre', 2, 223492),
  (2025, '2025-09-29', 'Extra Etanco', 2, 20000),
  (2025, '2025-10-28', 'Nómina Octubre', 1, 322050),
  (2025, '2025-10-29', 'Nómina Octubre', 2, 261573),
  (2025, '2025-10-29', 'Extra Etanco', 2, 20000),
  (2025, '2025-11-28', 'Nómina Noviembre', 1, 320199),
  (2025, '2025-11-28', 'Nómina Noviembre', 2, 225215),
  (2025, '2025-11-30', 'Extra Etanco', 2, 20000),
  (2025, '2025-12-12', 'Paga extra Diciembre', 2, 230653),
  (2025, '2025-12-18', 'Bonus', 2, 205926),
  (2025, '2025-12-26', 'Nómina + Bonus Diciembre', 1, 485574),
  (2025, '2025-12-29', 'Nómina Diciembre', 2, 236629),
  (2026, '2026-01-22', 'Extra Etanco enero', 2, 20000),
  (2026, '2026-01-28', 'Nómina enero', 1, 329502),
  (2026, '2026-01-30', 'Nómina enero', 2, 230683),
  (2026, '2026-02-07', 'Extra Etanco febrero', 2, 20000),
  (2026, '2026-02-26', 'Nómina febrero', 2, 230773),
  (2026, '2026-02-26', 'Nómina febrero', 1, 341323),
  (2026, '2026-03-13', 'Extra Etanco marzo-abril', 2, 40000),
  (2026, '2026-03-26', 'Nómina marzo', 2, 230767),
  (2026, '2026-03-30', 'Nómina marzo', 1, 351888),
  (2026, '2026-03-16', 'Extra Etanco mayo-junio', 2, 40000),
  (2026, '2026-04-29', 'Nómina abril', 2, 184652),
  (2026, '2026-05-14', 'SS Abril', 1, 95392),
  (2026, '2026-05-21', 'SS Abril', 2, 79494),
  (2026, '2026-05-29', 'SS Mayo', 1, 493966),
  (2026, '2026-05-29', 'SS Mayo', 2, 388340),
  (2026, '2026-06-06', 'SS Junio', 1, 79494),
  (2026, '2026-06-30', 'Nómina Junio', 1, 214568),
  (2026, '2026-06-30', 'SS Junio', 2, 374972),
  (2026, '2026-01-15', 'Paga extra julio', 2, 241524),
  (2026, '2026-07-31', 'SS Julio', 2, 388340),
  (2026, '2026-07-31', 'Nómina Julio', 1, 345000),
  (2026, '2026-08-27', 'Bonus', 1, 510715),
  (2026, '2026-08-31', 'SS Agosto', 2, 388340),
  (2026, '2026-03-04', 'Extra Etanco julio', 2, 20000),
  (2026, '2026-03-04', 'Extra Etanco agosto', 2, 20000),
  (2026, '2026-09-05', 'Nómina septiembre', 2, 209385),
  (2026, '2026-09-04', 'SS septiembre', 2, 49996),
  (2026, '2026-08-30', 'Nómina septiembre', 1, 350709);

PRAGMA optimize;

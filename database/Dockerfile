# Plain Postgres. The schema is NO LONGER created here.
#
# This image used to copy notes_table.sql into /docker-entrypoint-initdb.d/,
# which Postgres runs once on an empty data directory. That mechanism has two
# problems: it only ever runs on a brand-new volume (so it can't evolve a schema
# that already has data), and it lived separately from the app's own
# CREATE-IF-NOT-EXISTS, so the schema was defined in two places.
#
# The backend now owns the schema through an ordered, tracked migration system
# (backend/src/db/migrations, run on startup — see backend/src/db/migrate.ts).
# That is the single source of truth for both fresh and existing databases, so
# this image needs nothing but stock Postgres.
FROM postgres:18-alpine

CREATE TABLE request_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX request_limits_window_idx ON request_limits (window_start);

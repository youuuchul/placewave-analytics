-- 표: ops.freshness — 표별 신선도 (전체 교체)
-- 1행: 표 1개
-- 키: (dataset_name, table_name)
-- 파티션·클러스터: 없음 / 없음
-- 원천: 각 데이터셋 __TABLES__ (행 수·변경 시각), INFORMATION_SCHEMA.PARTITIONS (마지막 파티션)
-- 소비: 파이프라인 상태 확인 (화면 소비 없음)
--
-- 표 정의는 00_ops_tables.sql.
-- 매개변수: @run_id STRING

DELETE FROM ops.freshness WHERE TRUE;

INSERT INTO ops.freshness (dataset_name, table_name, row_count, last_loaded_at, last_date, run_id)
WITH t AS (
  SELECT 'raw' AS dataset_name, table_id, row_count, last_modified_time, type FROM raw.__TABLES__
  UNION ALL SELECT 'staging', table_id, row_count, last_modified_time, type FROM staging.__TABLES__
  UNION ALL SELECT 'marts', table_id, row_count, last_modified_time, type FROM marts.__TABLES__
),
p AS (
  SELECT 'raw' AS dataset_name, table_name, partition_id FROM raw.INFORMATION_SCHEMA.PARTITIONS
  UNION ALL SELECT 'staging', table_name, partition_id FROM staging.INFORMATION_SCHEMA.PARTITIONS
  UNION ALL SELECT 'marts', table_name, partition_id FROM marts.INFORMATION_SCHEMA.PARTITIONS
),
last_p AS (
  SELECT
    dataset_name,
    table_name,
    MAX(COALESCE(
      SAFE.PARSE_DATE('%Y%m%d', partition_id),
      LAST_DAY(SAFE.PARSE_DATE('%Y%m', partition_id), MONTH)
    )) AS last_date
  FROM p
  WHERE partition_id NOT IN ('__NULL__', '__UNPARTITIONED__')
  GROUP BY 1, 2
)
SELECT
  t.dataset_name,
  t.table_id,
  t.row_count,
  TIMESTAMP_MILLIS(t.last_modified_time),
  lp.last_date,
  @run_id
FROM t
LEFT JOIN last_p AS lp
  ON lp.dataset_name = t.dataset_name AND lp.table_name = t.table_id
WHERE t.type = 1;

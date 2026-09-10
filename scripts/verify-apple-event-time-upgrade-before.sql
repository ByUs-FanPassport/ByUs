\set ON_ERROR_STOP on

-- Seed both legacy second values and already-canonical millisecond values before
-- the event-time migration runs. These keys are isolated to the clean DB replay.
insert into public.apple_lifecycle_subjects(
  subject_hash,credential_state,credential_event_time
) values
  (lpad('1',64,'9'),'revoked',1789040700),
  (lpad('2',64,'9'),'authorized',0),
  (lpad('3',64,'9'),'revoked',1789040700123);

insert into public.apple_relay_availability(
  subject_hash,destination_fingerprint,state,event_time
) values
  (lpad('1',64,'9'),repeat('8',64),'disabled',1789040701),
  (lpad('3',64,'9'),repeat('7',64),'enabled',1789040701123);

insert into public.apple_notification_events(
  audience,event_id,payload_hash,event_type,subject_hash,event_time,issued_at
) values
  ('kr.byus.web','upgrade-legacy-seconds',repeat('6',64),'consent-revoked',
    lpad('1',64,'9'),1789040700,1789040700),
  ('kr.byus.web','upgrade-canonical-milliseconds',repeat('5',64),'consent-revoked',
    lpad('3',64,'9'),1789040700123,1789040700);

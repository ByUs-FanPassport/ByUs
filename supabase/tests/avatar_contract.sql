begin;

insert into public.app_users (id, privy_user_id, verified_email, status)
values (
  '11111111-1111-4111-8111-111111111111',
  'did:privy:avatar-contract',
  'avatar-contract@byus.test',
  'active'
);

do $$
declare
  first_state jsonb;
  second_state jsonb;
  selected_state jsonb;
  removed_state jsonb;
begin
  first_state := public.ensure_owned_avatar('11111111-1111-4111-8111-111111111111');
  second_state := public.ensure_owned_avatar('11111111-1111-4111-8111-111111111111');
  if first_state->>'initialCharacterId' is distinct from second_state->>'initialCharacterId' then
    raise exception 'initial character changed across ensure calls';
  end if;
  if (first_state->>'revision')::integer <> 0 or first_state->>'source' <> 'default' then
    raise exception 'initial avatar state is invalid';
  end if;

  selected_state := public.set_owned_avatar_image(
    '11111111-1111-4111-8111-111111111111',
    'upload',
    '11111111-1111-4111-8111-111111111111/1-22222222-2222-4222-8222-222222222222.webp',
    0
  );
  if selected_state->>'source' <> 'upload' or (selected_state->>'revision')::integer <> 1 then
    raise exception 'image CAS did not commit expected state';
  end if;

  begin
    perform public.set_owned_avatar_character(
      '11111111-1111-4111-8111-111111111111', 'heart-pink', 0
    );
    raise exception 'stale CAS unexpectedly succeeded';
  exception
    when others then
      if sqlerrm not like '%AVATAR_STALE_REVISION%' then raise; end if;
  end;

  removed_state := public.remove_owned_avatar(
    '11111111-1111-4111-8111-111111111111', 1
  );
  if removed_state->>'source' <> 'removed'
    or removed_state->>'characterId' <> first_state->>'initialCharacterId'
    or (removed_state->>'revision')::integer <> 2 then
    raise exception 'remove did not restore the immutable initial character';
  end if;

  begin
    perform public.set_owned_avatar_image(
      '11111111-1111-4111-8111-111111111111',
      'google',
      '11111111-1111-4111-8111-111111111111/3-33333333-3333-4333-8333-333333333333.webp',
      2
    );
    raise exception 'google import unexpectedly restored a removed avatar';
  exception
    when others then
      if sqlerrm not like '%AVATAR_GOOGLE_IMPORT_NOT_DEFAULT%' then raise; end if;
  end;

  begin
    update public.app_user_avatars
    set initial_character_id = case
      when initial_character_id = 'ghost-lavender' then 'star-cream'
      else 'ghost-lavender'
    end
    where app_user_id = '11111111-1111-4111-8111-111111111111';
    raise exception 'immutable initial character unexpectedly changed';
  exception
    when others then
      if sqlerrm not like '%AVATAR_INITIAL_CHARACTER_IMMUTABLE%' then raise; end if;
  end;
end;
$$;

rollback;

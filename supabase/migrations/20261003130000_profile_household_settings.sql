-- Keep profile edits scoped to the signed-in profile and allow either
-- authenticated member of the household to rename that household. The
-- existing profile update policy remains unchanged; this only fills the
-- missing household update capability without broadening access.
drop policy if exists households_update_members on public.households;
create policy households_update_members
  on public.households
  for update
  to authenticated
  using (
    id = (select my_household_id())
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.household_id = households.id
    )
  )
  with check (id = (select my_household_id()));

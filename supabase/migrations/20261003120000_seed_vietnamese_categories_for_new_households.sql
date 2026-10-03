-- New households use Vietnamese default category labels.
-- This forward migration only replaces the seeding RPC used when a household is
-- created. It does not update categories belonging to existing households, so
-- custom and previously seeded names remain unchanged.
create or replace function public.create_household(household_name text default 'Nuestro hogar'::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_household_id uuid;
  v_user_id uuid;
  v_fijos uuid;
  v_variables uuid;
  v_ocio uuid;
  v_metas uuid;
begin
  -- 1. Create the household
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  insert into households (name) values (household_name) returning id into v_household_id;

  -- 2. Assign the user to the household
  update profiles set household_id = v_household_id where id = v_user_id;

  -- 3. Seed the 4 master groups (headers, not budgetable)
  insert into categories (household_id, name, icon, kind, is_group, is_default)
    values (v_household_id, 'Chi phí cố định', '📌', 'expense', true, false) returning id into v_fijos;
  insert into categories (household_id, name, icon, kind, is_group, is_default)
    values (v_household_id, 'Chi phí biến đổi', '🛒', 'expense', true, false) returning id into v_variables;
  insert into categories (household_id, name, icon, kind, is_group, is_default)
    values (v_household_id, 'Giải trí', '🎉', 'expense', true, false) returning id into v_ocio;
  insert into categories (household_id, name, icon, kind, is_group, is_default)
    values (v_household_id, 'Tiết kiệm và mục tiêu', '🎯', 'expense', true, false) returning id into v_metas;

  -- 4. Seed default expense categories, nested under their group
  insert into categories (household_id, name, icon, kind, is_default, parent_id) values
    (v_household_id, 'Ăn uống và giao hàng', '🍕', 'expense', true, v_variables),
    (v_household_id, 'Siêu thị và tạp hóa', '🛒', 'expense', true, v_variables),
    (v_household_id, 'Di chuyển', '🚇', 'expense', true, v_variables),
    (v_household_id, 'Sức khỏe', '💊', 'expense', true, v_variables),
    (v_household_id, 'Quần áo và giày dép', '👗', 'expense', true, v_variables),
    (v_household_id, 'Nhà cửa và gia đình', '🏠', 'expense', true, v_variables),
    (v_household_id, 'Công nghệ', '💻', 'expense', true, v_variables),
    (v_household_id, 'Giáo dục', '📚', 'expense', true, v_variables),
    (v_household_id, 'Chi phí khác', '🏷️', 'expense', true, v_variables),
    (v_household_id, 'Dịch vụ đăng ký', '📱', 'expense', true, v_fijos),
    (v_household_id, 'Đi chơi và giải trí', '🎭', 'expense', true, v_ocio),
    (v_household_id, 'Du lịch', '✈️', 'expense', true, v_ocio);

  -- 5. Income categories (ungrouped; the budget is expense-only)
  insert into categories (household_id, name, icon, kind, is_default) values
    (v_household_id, 'Lương', '💵', 'income', true),
    (v_household_id, 'Làm việc tự do', '💼', 'income', true),
    (v_household_id, 'Thu nhập khác', '💰', 'income', true);

  return v_household_id;
end;
$function$;

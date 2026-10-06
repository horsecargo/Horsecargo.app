-- Local test fixtures only: one user per new v6 role (password Pass1234!).
insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000011','manager@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Mariam Manager"}'),
 ('00000000-0000-0000-0000-000000000012','hr@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Halima HR"}'),
 ('00000000-0000-0000-0000-000000000013','logistics@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Lucas Logistics"}'),
 ('00000000-0000-0000-0000-000000000014','sales@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Sara Sales"}'),
 ('00000000-0000-0000-0000-000000000015','sourcing@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Said Sourcing"}'),
 ('00000000-0000-0000-0000-000000000016','care@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Catherine Care"}');
update profiles set active=true, branch_code='DXB', role=case split_part(email,'@',1)
  when 'manager' then 'manager' when 'hr' then 'hr' when 'logistics' then 'logistics' when 'sales' then 'sales_marketing'
  when 'sourcing' then 'sourcing' when 'care' then 'customer_care' end::app_role
 where email in ('manager@hc.test','hr@hc.test','logistics@hc.test','sales@hc.test','sourcing@hc.test','care@hc.test');

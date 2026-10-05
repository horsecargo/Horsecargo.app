-- Local test fixtures only.
insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','admin@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Test Admin"}'),
 ('00000000-0000-0000-0000-000000000002','counter@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Test Counter"}'),
 ('00000000-0000-0000-0000-000000000003','cashier@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Test Cashier"}'),
 ('00000000-0000-0000-0000-000000000004','warehouse@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Test Warehouse"}'),
 ('00000000-0000-0000-0000-000000000005','ops@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Test Operations"}'),
 ('00000000-0000-0000-0000-000000000006','release@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Test Release"}'),
 ('00000000-0000-0000-0000-000000000007','accountant@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Test Accountant"}'),
 ('00000000-0000-0000-0000-000000000008','finance@hc.test',crypt('Pass1234!',gen_salt('bf')),'{"full_name":"Test Finance"}');
update profiles set role=case split_part(email,'@',1) when 'ops' then 'operations' when 'release' then 'release_officer'
  when 'finance' then 'finance_manager' else split_part(email,'@',1) end::app_role,
  active=true,branch_code='DXB';

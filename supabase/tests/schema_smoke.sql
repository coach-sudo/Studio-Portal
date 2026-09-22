begin;

create extension if not exists pgtap with schema extensions;

select plan(3);
select has_table('public', 'studios', 'studios table exists after reset');
select has_table('public', 'memberships', 'memberships table exists after reset');
select has_column('public', 'package_definitions', 'benefit_text', 'PR6 package benefit column exists after reset');
select * from finish();

rollback;

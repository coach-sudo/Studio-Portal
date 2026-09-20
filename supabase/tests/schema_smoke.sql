begin;

create extension if not exists pgtap with schema extensions;

select plan(2);
select has_table('public', 'studios', 'studios table exists after reset');
select has_table('public', 'memberships', 'memberships table exists after reset');
select * from finish();

rollback;

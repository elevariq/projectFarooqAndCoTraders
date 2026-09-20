#!/usr/bin/env bash
# Two-process race test for the data core: run ON THE SERVER next to test-data-core.php (with api/_data.php + api/_stores.php beside it).
#   bash race-data-core.sh <dir holding test-data-core.php> [rounds]      (API=<dir with a mutated _data.php> to mutation-test it)
# Expect: exactly-one-winner == rounds, BOTH-WON(bad) == 0, for both "create" and "update". Cleans up its zz_dc_* keys.
# usage: race.sh <dir holding test-data-core.php> <rounds>
cd "$1"; R=${2:-20}; A=""; [ -n "$API" ] && A="--api=$API"; both_ok=0; none_ok=0; one_ok=0
for how in create update; do
  one_ok=0; both_ok=0; none_ok=0
  for i in $(seq 1 $R); do
    key="zz_dc_race_${how}_$i"
    [ "$how" = update ] && php test-data-core.php prep "$key" $A
    at=$(php -r 'echo microtime(true)+0.7;')
    php test-data-core.php race A "$at" "$key" $how $A > /tmp/race_a.$$ &
    php test-data-core.php race B "$at" "$key" $how $A > /tmp/race_b.$$ &
    wait
    n=$(cat /tmp/race_a.$$ /tmp/race_b.$$ | grep -c '"ok":true')
    case $n in 1) one_ok=$((one_ok+1));; 2) both_ok=$((both_ok+1));; *) none_ok=$((none_ok+1));; esac
  done
  echo "race[$how] rounds=$R  exactly-one-winner=$one_ok  BOTH-WON(bad)=$both_ok  none=$none_ok"
done
rm -f /tmp/race_a.$$ /tmp/race_b.$$
php test-data-core.php clean $A

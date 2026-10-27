import math
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.analytics_schema import EVENT_USER_NAMES
from app.db import get_analytics_summary, init_db, insert_analytics_event
from app.services.analytics_store import RedisAnalyticsStore, _PREFIX, _bucket_key


class MemoryRedis:
    def __init__(self):
        self.data = {}
        self.executions = 0

    def pipeline(self, transaction=False):
        owner = self

        class Pipeline:
            def __init__(self):
                self.commands = []

            def __getattr__(self, command):
                def enqueue(*args):
                    self.commands.append((command, args))
                    return self
                return enqueue

            def execute(self):
                owner.executions += 1
                return [owner.apply(command, *args) for command, args in self.commands]

        return Pipeline()

    def apply(self, command, key, *args):
        if command == 'expire':
            return True
        if command == 'hgetall':
            return dict(self.data.get(key, {}))
        if command == 'smembers':
            return set(self.data.get(key, set()))
        if command == 'lrange':
            return list(self.data.get(key, []))[args[0]:args[1] + 1]
        if command == 'hincrby':
            value = self.data.setdefault(key, {})
            value[args[0]] = value.get(args[0], 0) + args[1]
            return value[args[0]]
        if command == 'sadd':
            self.data.setdefault(key, set()).add(args[0])
            return 1
        if command == 'lpush':
            self.data.setdefault(key, []).insert(0, args[0])
            return len(self.data[key])
        if command == 'ltrim':
            self.data[key] = self.data[key][args[0]:args[1] + 1]
            return True
        raise AssertionError(command)


class RedisAnalyticsTest(unittest.TestCase):
    def setUp(self):
        self.store = RedisAnalyticsStore.__new__(RedisAnalyticsStore)
        self.redis = self.store._redis = MemoryRedis()
        self.now = datetime(2026, 10, 23, 4, 35, tzinfo=timezone.utc)
        self.clock = patch('app.services.analytics_store.datetime').start()
        self.clock.now.return_value = self.now
        self.addCleanup(patch.stopall)

    def record(self, name, user='browser-a', **properties):
        self.assertTrue(self.store.record(event_name=name, distinct_id=user, path='/tracking', properties=properties))

    def test_feed_empty_pages_are_distinct_from_pages_with_results(self):
        self.record('squad_feed_list_empty')
        self.record('squad_feed_list_empty')
        self.record('squad_feed_list_with_results', 'browser-b')
        result = self.store.summary()
        self.assertEqual(result['feed_list_results']['empty_pages'], {'events': 2, 'unique_users': 1})
        self.assertEqual(result['feed_list_results']['nonempty_pages'], {'events': 1, 'unique_users': 1})

    def test_completed_events_and_distinct_browsers_are_separate(self):
        self.record('before_after_completed')
        self.record('before_after_completed')
        self.record('before_after_failed', 'browser-b', error_kind='timeout')
        self.record('squad_feed_selection_completed')
        self.record('adopt_action')
        result = self.store.summary(limit=1)
        self.assertEqual(result['feature_usage']['before_after'], {
            'completed_events': 2, 'completed_users': 1, 'failed_events': 1, 'failed_users': 1})
        self.assertEqual(result['feature_usage']['feed_selection']['completed_events'], 1)
        self.assertEqual(result['feature_usage']['feed_connection']['completed_events'], 0)
        self.assertEqual(result['recent_failures'][0]['event_name'], 'before_after_failed')
        self.assertEqual(result['unique_users'], 2)
        self.assertFalse(result['measurement']['event_intersections_are_ordered'])

    def test_new_and_returning_events_can_share_a_browser(self):
        self.record('visitor_first_seen')
        self.record('visitor_return')
        result = self.store.summary()
        self.assertEqual(result['unique_users'], 1)
        self.assertEqual(result['visitor_lifecycle']['new'], {'events': 1, 'unique_users': 1})
        self.assertEqual(result['visitor_lifecycle']['returning'], {'events': 1, 'unique_users': 1})

    def test_hosts_include_unclassified_historical_views_without_guessing(self):
        bucket = _bucket_key(self.now)
        self.redis.data[f'{_PREFIX}:events:{bucket}'] = {'page_view': 2}
        self.redis.data[f'{_PREFIX}:paths:{bucket}'] = {'/search': 2}
        self.record('page_view', hostname='fcoach.fun')
        self.record('page_view', hostname='www.fcoach.fun')
        result = self.store.summary()
        self.assertEqual({row['hostname']: row['count'] for row in result['page_view_hosts']},
                         {'unknown': 2, 'fcoach.fun': 1, 'www.fcoach.fun': 1})

    def test_hour_bucket_bounds_are_explicit_and_reads_are_batched(self):
        first_hour = self.now - timedelta(hours=24, minutes=20)
        self.clock.now.return_value = first_hour
        self.record('before_after_completed')
        self.clock.now.return_value = self.now
        before = self.redis.executions
        result = self.store.summary(hours=24)
        self.assertEqual(self.redis.executions - before, math.ceil(25 / 24))
        self.assertEqual(result['aggregation'], 'hour_buckets')
        self.assertEqual(result['bucket_since'], '2026-10-22T04:00:00+00:00')
        self.assertEqual(result['since'], '2026-10-22T04:35:00+00:00')
        self.assertEqual(result['until'], self.now.isoformat())
        self.assertEqual(result['feature_usage']['before_after']['completed_events'], 1)
        self.assertEqual(len(result['event_users']), len(EVENT_USER_NAMES))

    def test_redis_failure_reports_sqlite_instead_of_pretending_redis_succeeded(self):
        self.redis.pipeline = lambda **kwargs: (_ for _ in ()).throw(ConnectionError())
        with patch('app.services.analytics_store.get_sqlite_analytics_summary', return_value={'source': 'sqlite'}):
            self.assertEqual(self.store.summary()['source'], 'sqlite')


class SQLiteAnalyticsTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        env = patch.dict(os.environ, {'HABIT_LAB_DB_PATH': f'{folder.name}/test.sqlite3'})
        env.start()
        self.addCleanup(env.stop)
        init_db()

    def test_feature_counts_survive_event_limit_and_old_experiments_stay_separate(self):
        for name, browser in [('before_after_completed', 'one'), ('before_after_completed', 'one'),
                              ('before_after_failed', 'two'), ('squad_feed_selection_completed', 'one'),
                              ('squad_feed_connection_failed', 'one'), ('adopt_action', 'one')]:
            insert_analytics_event(name, distinct_id=browser)
        result = get_analytics_summary(limit=1)
        self.assertEqual(result['feature_usage']['before_after'], {
            'completed_events': 2, 'completed_users': 1, 'failed_events': 1, 'failed_users': 1})
        self.assertEqual(result['feature_usage']['feed_connection']['completed_events'], 0)
        self.assertEqual(result['feature_usage']['feed_connection']['failed_events'], 1)
        self.assertEqual(result['event_counts']['adopt_action'], 1)
        self.assertEqual(result['source'], 'sqlite')
        self.assertEqual(result['aggregation'], 'exact_timestamps')
        self.assertIn(result['recent_failures'][0]['event_name'], ('before_after_failed', 'squad_feed_connection_failed'))

    def test_session_fallback_uses_the_same_distinct_browser_rule(self):
        insert_analytics_event('before_after_completed', session_id='session-only')
        result = get_analytics_summary()
        self.assertEqual(result['unique_users'], 1)
        self.assertEqual(result['feature_usage']['before_after']['completed_users'], 1)


class AnalyticsOriginTest(unittest.TestCase):
    def request(self, origin):
        from starlette.requests import Request
        headers = [(b'origin', origin.encode())] if origin else []
        return Request({'type': 'http', 'method': 'POST', 'path': '/events/track', 'headers': headers})

    def test_nonproduction_origins_are_not_recorded_or_forwarded(self):
        from app.main import events_track
        from app.models import EventTrackRequest
        for origin in ('http://localhost:3010', 'https://web-preview.vercel.app', 'https://fcoach.fun.other.example', None):
            with self.subTest(origin=origin), patch('app.main._enforce_rate_limit'), \
                 patch('app.main.record_analytics_event') as record, patch('app.main._forward_event_to_posthog') as forward:
                result = events_track(self.request(origin), EventTrackRequest(event_name='page_view'))
                self.assertFalse(result['recorded'])
                record.assert_not_called()
                forward.assert_not_called()

    def test_origin_overrides_payload_host_and_personal_values_are_dropped(self):
        from app.main import events_track
        from app.models import EventTrackRequest
        with patch('app.main._enforce_rate_limit'), patch('app.main.record_analytics_event') as record, \
             patch('app.main._forward_event_to_posthog') as forward:
            result = events_track(self.request('https://www.fcoach.fun'), EventTrackRequest(
                event_name='before_after_failed', properties={'hostname': 'localhost', 'error_kind': 'timeout',
                'nickname': 'private-name', 'ouid_masked': 'private-id', 'error_message': 'private-message'}))
            self.assertTrue(result['recorded'])
            properties = record.call_args.kwargs['properties']
            self.assertEqual(properties, {'hostname': 'www.fcoach.fun', 'environment': 'production', 'error_kind': 'timeout'})
            self.assertEqual(forward.call_args.args[0].properties, properties)


if __name__ == '__main__':
    unittest.main()

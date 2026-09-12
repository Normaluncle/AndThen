"""Run with python -m unittest discover -s services/memory -v.
Set MEMORY_LIVE_TEST=1 to exercise the configured real embedding provider.
"""
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault('MEMORY_DATA_DIR', tempfile.mkdtemp(prefix='andthen-memory-test-'))
os.environ.setdefault('MEMORY_SERVICE_TOKEN', 'test-only-service-token')
import server


class MemoryTests(unittest.IsolatedAsyncioTestCase):
    def test_path_and_auth(self):
        with self.assertRaises(Exception):
            server.location('../outside', str(uuid.uuid4()))
        with self.assertRaises(Exception):
            server.authorize('wrong')

    @unittest.skipUnless(os.environ.get('MEMORY_LIVE_TEST') == '1', 'real provider test is opt-in')
    async def test_real_lifecycle(self):
        owner, other, gen = [str(uuid.uuid4()) for _ in range(3)]
        token = os.environ['MEMORY_SERVICE_TOKEN']
        # >20 entries proves batching is configured for Bailian's request limit.
        records = [server.Record(name=f'fixture-{i}', description='烘焙爱好', content=f'测试资料{i}：周末烤面包。') for i in range(21)]
        records.append(server.Record(name='career', description='转行求职经历', content='测试作者学习编程八个月后找到了第一份软件工作。'))
        body = server.Build(records=records)
        await server.rebuild(owner, gen, body, token)
        await server.rebuild(owner, gen, body, token)
        result = await server.query(owner, gen, server.Query(text='转行找到工作用了多久？'), token)
        self.assertEqual(result['files'][0]['name'], 'career')
        with self.assertRaises(Exception):
            await server.query(other, gen, server.Query(text='工作'), token)
        await server.delete(owner, gen, token)
        with self.assertRaises(Exception):
            await server.query(owner, gen, server.Query(text='工作'), token)

    async def test_provider_failure_has_no_ready_marker(self):
        owner, gen = str(uuid.uuid4()), str(uuid.uuid4())
        with patch('server.memory', side_effect=RuntimeError('unavailable')):
            with self.assertRaises(Exception):
                await server.rebuild(owner, gen, server.Build(records=[]), os.environ['MEMORY_SERVICE_TOKEN'])
        self.assertFalse((server.location(owner, gen) / 'ready').exists())

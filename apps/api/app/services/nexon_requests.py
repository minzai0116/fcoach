"""한 프로세스의 넥슨 요청 속도와 동시 연결 수를 제한한다."""
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor


class RequestPacer:
    def __init__(self, clock=time.monotonic, sleep=time.sleep):
        self.clock, self.sleep = clock, sleep
        self.lock = threading.Lock()
        self.next_request = 0.0

    def acquire(self):
        try:
            rate = max(1, min(100, int(os.getenv('HABIT_LAB_NEXON_REQUESTS_PER_SECOND', '4'))))
        except ValueError:
            rate = 4
        with self.lock:
            now = self.clock()
            reserved = max(now, self.next_request)
            self.next_request = reserved + 1 / rate
        if reserved > now:
            self.sleep(reserved - now)


REQUEST_PACER = RequestPacer()
REQUEST_SLOTS = threading.BoundedSemaphore(8)
DETAIL_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix='nexon-detail')

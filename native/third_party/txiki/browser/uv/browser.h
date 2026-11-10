#ifndef UV_BROWSER_H
#define UV_BROWSER_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

typedef struct uv__io_s uv__io_t;
struct uv__io_s {
  uintptr_t bits;
  struct uv__queue pending_queue;
  struct uv__queue watcher_queue;
  unsigned int pevents;
  unsigned int events;
  int fd;
};

#define UV_PLATFORM_SEM_T int

typedef struct uv_buf_t {
  char* base;
  size_t len;
} uv_buf_t;

typedef int uv_file;
typedef int uv_os_sock_t;
typedef int uv_os_fd_t;
typedef int uv_pid_t;

#define UV_ONCE_INIT 0
typedef int uv_once_t;
typedef unsigned long uv_thread_t;
typedef int uv_mutex_t;
typedef int uv_rwlock_t;
typedef int uv_sem_t;
typedef int uv_cond_t;
typedef int uv_key_t;
typedef int uv_barrier_t;

typedef unsigned int uv_gid_t;
typedef unsigned int uv_uid_t;

#define UV_DIR_PRIVATE_FIELDS \
  void* dir;

#define HAVE_DIRENT_TYPES
#define UV__DT_FILE 1
#define UV__DT_DIR 2
#define UV__DT_LINK 3
#define UV__DT_FIFO 4
#define UV__DT_SOCKET 5
#define UV__DT_CHAR 6
#define UV__DT_BLOCK 7

#define UV_DYNAMIC

typedef struct {
  void* handle;
  char* errmsg;
} uv_lib_t;

struct uv__pending {
  void (*fn)(void* arg);
  void* arg;
  struct uv__pending* next;
};

#define UV_LOOP_PRIVATE_FIELDS \
  struct uv__queue idle_handles; \
  struct uv__queue prepare_handles; \
  struct uv__queue check_handles; \
  struct uv__queue async_handles; \
  uv_handle_t* closing_handles; \
  uv_timer_t* timers; \
  struct uv__pending* pending_head; \
  struct uv__pending* pending_tail; \
  uint64_t time;

#define UV_REQ_TYPE_PRIVATE

struct uv__req_write_extra_s {
  size_t nwritten;
};

#define UV_REQ_PRIVATE_FIELDS \
  union { \
    void* reserved2[1]; \
    struct uv__req_write_extra_s write_extra; \
  };

#define UV_PRIVATE_REQ_TYPES

#define UV_WRITE_PRIVATE_FIELDS \
  struct uv__queue queue; \
  unsigned int write_index; \
  uv_buf_t* bufs; \
  unsigned int nbufs; \
  int error; \
  uv_buf_t bufsml[4];

#define UV_CONNECT_PRIVATE_FIELDS \
  struct uv__queue queue;

#define UV_SHUTDOWN_PRIVATE_FIELDS

#define UV_UDP_SEND_PRIVATE_FIELDS \
  struct uv__queue queue; \
  unsigned int nbufs; \
  uv_buf_t* bufs; \
  ssize_t status; \
  uv_udp_send_cb send_cb; \
  uv_buf_t bufsml[4];

#define UV_HANDLE_PRIVATE_FIELDS \
  uv_handle_t* next_closing; \
  unsigned int flags;

#define UV_STREAM_PRIVATE_FIELDS \
  uv_connect_t* connect_req; \
  uv_shutdown_t* shutdown_req; \
  uv__io_t io_watcher; \
  struct uv__queue write_queue; \
  struct uv__queue write_completed_queue;

#define UV_TCP_PRIVATE_FIELDS
#define UV_UDP_PRIVATE_FIELDS \
  uv_alloc_cb alloc_cb; \
  uv_udp_recv_cb recv_cb; \
  uv__io_t io_watcher; \
  struct uv__queue write_queue; \
  struct uv__queue write_completed_queue;
#define UV_PIPE_PRIVATE_FIELDS \
  int pipe_fname_unused;
#define UV_POLL_PRIVATE_FIELDS \
  uv__io_t io_watcher;
#define UV_PREPARE_PRIVATE_FIELDS \
  uv_prepare_cb prepare_cb; \
  struct uv__queue queue;
#define UV_CHECK_PRIVATE_FIELDS \
  uv_check_cb check_cb; \
  struct uv__queue queue;
#define UV_IDLE_PRIVATE_FIELDS \
  uv_idle_cb idle_cb; \
  struct uv__queue queue;
#define UV_ASYNC_PRIVATE_FIELDS \
  uv_async_cb async_cb; \
  struct uv__queue queue; \
  int pending;
#define UV_TIMER_PRIVATE_FIELDS \
  uv_timer_cb timer_cb; \
  uv_timer_t* next_timer; \
  uint64_t timeout; \
  uint64_t repeat;
#define UV_GETADDRINFO_PRIVATE_FIELDS \
  struct uv__queue queue;
#define UV_GETNAMEINFO_PRIVATE_FIELDS \
  struct uv__queue queue;
#define UV_PROCESS_PRIVATE_FIELDS \
  struct uv__queue queue; \
  int status;
#define UV_FS_PRIVATE_FIELDS \
  const char* new_path; \
  uv_file file; \
  int flags; \
  mode_t mode; \
  unsigned int nbufs; \
  uv_buf_t* bufs; \
  off_t off; \
  uv_uid_t uid; \
  uv_gid_t gid; \
  double atime; \
  double mtime; \
  struct uv__work work_req; \
  uv_buf_t bufsml[4];
#define UV_WORK_PRIVATE_FIELDS \
  struct uv__work work_req;
#define UV_FS_EVENT_PRIVATE_FIELDS
#define UV_SIGNAL_PRIVATE_FIELDS \
  struct uv__queue queue; \
  unsigned int caught_signals; \
  unsigned int dispatched_signals;
#define UV_FS_POLL_PRIVATE_FIELDS
#define UV_TTY_PRIVATE_FIELDS \
  int fd;
struct uv_sockaddr_s {
  unsigned short sa_family;
  char sa_data[14];
};

struct uv_sockaddr_in_s {
  unsigned short sin_family;
  unsigned short sin_port;
  struct {
    unsigned long s_addr;
  } sin_addr;
};

struct uv_sockaddr_in6_s {
  unsigned short sin6_family;
  unsigned short sin6_port;
  unsigned long sin6_flowinfo;
  struct {
    unsigned char s6_addr[16];
  } sin6_addr;
  unsigned long sin6_scope_id;
};

struct uv__work {
  void (*work)(struct uv__work* w);
  void (*done)(struct uv__work* w, int status);
  struct uv_loop_s* loop;
  void* wq[2];
};

#endif

#include <stddef.h>
#include "private.h"
bool tjs__channel_mailbox_pair(TJSMailbox **a, TJSMailbox **b) { return false; }
void tjs__channel_mailbox_unref(TJSMailbox *mb) {  }
void tjs__channel_port_close(JSRuntime *rt, JSValue port_handle) {  }
void tjs__channel_port_flush(JSRuntime *rt, JSValue port_handle) {  }
JSValue tjs__channel_port_new(JSContext *ctx, TJSMailbox *rx, TJSMailbox *tx) { return JS_UNDEFINED; }
void tjs__channel_port_post_error(JSContext *ctx, JSValue port_handle, JSValueConst error_obj) {  }
void tjs__channel_port_unref(JSRuntime *rt, JSValue port_handle) {  }
void tjs__mod_channel_init(JSContext *ctx, JSValue ns) {  }
void tjs__mod_dns_init(JSContext *ctx, JSValue ns) {  }
void tjs__mod_fswatch_init(JSContext *ctx, JSValue ns) {  }
void tjs__mod_posix_socket_init(JSContext *ctx, JSValue ns) {  }
void tjs__mod_process_init(JSContext *ctx, JSValue ns) {  }
void tjs__mod_udp_init(JSContext *ctx, JSValue ns) {  }
int uv_accept(uv_stream_t* server, uv_stream_t* client) { return UV_ENOSYS; }
unsigned int uv_available_parallelism(void) { return 1; }
int uv_chdir(const char* dir) { return UV_ENOSYS; }
int uv_cpu_info(uv_cpu_info_t** cpu_infos, int* count) { return UV_ENOSYS; }
int uv_cwd(char* buffer, size_t* size) { return UV_ENOSYS; }
int uv_exepath(char* buffer, size_t* size) { return UV_ENOSYS; }
void uv_free_cpu_info(uv_cpu_info_t* cpu_infos, int count) {  }
void uv_free_interface_addresses(uv_interface_address_t* addresses,
                                           int count) {  }
int uv_fs_chmod(uv_loop_t* loop,
                          uv_fs_t* req,
                          const char* path,
                          int mode,
                          uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_chown(uv_loop_t* loop,
                          uv_fs_t* req,
                          const char* path,
                          uv_uid_t uid,
                          uv_gid_t gid,
                          uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_close(uv_loop_t* loop,
                          uv_fs_t* req,
                          uv_file file,
                          uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_closedir(uv_loop_t* loop,
                             uv_fs_t* req,
                             uv_dir_t* dir,
                             uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_copyfile(uv_loop_t* loop,
                             uv_fs_t* req,
                             const char* path,
                             const char* new_path,
                             int flags,
                             uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_fchmod(uv_loop_t* loop,
                           uv_fs_t* req,
                           uv_file file,
                           int mode,
                           uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_fchown(uv_loop_t* loop,
                           uv_fs_t* req,
                           uv_file file,
                           uv_uid_t uid,
                           uv_gid_t gid,
                           uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_fdatasync(uv_loop_t* loop,
                              uv_fs_t* req,
                              uv_file file,
                              uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_fstat(uv_loop_t* loop,
                          uv_fs_t* req,
                          uv_file file,
                          uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_fsync(uv_loop_t* loop,
                          uv_fs_t* req,
                          uv_file file,
                          uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_ftruncate(uv_loop_t* loop,
                              uv_fs_t* req,
                              uv_file file,
                              int64_t offset,
                              uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_futime(uv_loop_t* loop,
                           uv_fs_t* req,
                           uv_file file,
                           double atime,
                           double mtime,
                           uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_lchown(uv_loop_t* loop,
                           uv_fs_t* req,
                           const char* path,
                           uv_uid_t uid,
                           uv_gid_t gid,
                           uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_link(uv_loop_t* loop,
                         uv_fs_t* req,
                         const char* path,
                         const char* new_path,
                         uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_lstat(uv_loop_t* loop,
                          uv_fs_t* req,
                          const char* path,
                          uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_lutime(uv_loop_t* loop,
                           uv_fs_t* req,
                           const char* path,
                           double atime,
                           double mtime,
                           uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_mkdir(uv_loop_t* loop,
                          uv_fs_t* req,
                          const char* path,
                          int mode,
                          uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_mkdtemp(uv_loop_t* loop,
                            uv_fs_t* req,
                            const char* tpl,
                            uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_mkstemp(uv_loop_t* loop,
                            uv_fs_t* req,
                            const char* tpl,
                            uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_open(uv_loop_t* loop,
                         uv_fs_t* req,
                         const char* path,
                         int flags,
                         int mode,
                         uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_opendir(uv_loop_t* loop,
                            uv_fs_t* req,
                            const char* path,
                            uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_read(uv_loop_t* loop,
                         uv_fs_t* req,
                         uv_file file,
                         const uv_buf_t bufs[],
                         unsigned int nbufs,
                         int64_t offset,
                         uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_readdir(uv_loop_t* loop,
                            uv_fs_t* req,
                            uv_dir_t* dir,
                            uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_readlink(uv_loop_t* loop,
                             uv_fs_t* req,
                             const char* path,
                             uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_realpath(uv_loop_t* loop,
                             uv_fs_t* req,
                             const char* path,
                             uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_rename(uv_loop_t* loop,
                           uv_fs_t* req,
                           const char* path,
                           const char* new_path,
                           uv_fs_cb cb) { return UV_ENOSYS; }
void uv_fs_req_cleanup(uv_fs_t* req) {  }
int uv_fs_rmdir(uv_loop_t* loop,
                          uv_fs_t* req,
                          const char* path,
                          uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_stat(uv_loop_t* loop,
                         uv_fs_t* req,
                         const char* path,
                         uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_statfs(uv_loop_t* loop,
                           uv_fs_t* req,
                           const char* path,
                           uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_symlink(uv_loop_t* loop,
                            uv_fs_t* req,
                            const char* path,
                            const char* new_path,
                            int flags,
                            uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_unlink(uv_loop_t* loop,
                           uv_fs_t* req,
                           const char* path,
                           uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_utime(uv_loop_t* loop,
                          uv_fs_t* req,
                          const char* path,
                          double atime,
                          double mtime,
                          uv_fs_cb cb) { return UV_ENOSYS; }
int uv_fs_write(uv_loop_t* loop,
                          uv_fs_t* req,
                          uv_file file,
                          const uv_buf_t bufs[],
                          unsigned int nbufs,
                          int64_t offset,
                          uv_fs_cb cb) { return UV_ENOSYS; }
int uv_inet_pton(int af, const char* src, void* dst) { return UV_ENOSYS; }
int uv_interface_addresses(uv_interface_address_t** addresses,
                                     int* count) { return UV_ENOSYS; }
int uv_ip4_name(const uv_sockaddr_in_t* src, char* dst, size_t size) { return UV_ENOSYS; }
int uv_ip6_name(const uv_sockaddr_in6_t* src, char* dst, size_t size) { return UV_ENOSYS; }
int uv_listen(uv_stream_t* stream, int backlog, uv_connection_cb cb) { return UV_ENOSYS; }
void uv_loadavg(double avg[3]) {  }
int uv_os_environ(uv_env_item_t** envitems, int* count) { return UV_ENOSYS; }
void uv_os_free_environ(uv_env_item_t* envitems, int count) {  }
void uv_os_free_passwd(uv_passwd_t* pwd) {  }
int uv_os_getenv(const char* name, char* buffer, size_t* size) { return UV_ENOSYS; }
int uv_os_gethostname(char* buffer, size_t* size) { return UV_ENOSYS; }
int uv_os_get_passwd(uv_passwd_t* pwd) { return UV_ENOSYS; }
uv_pid_t uv_os_getpid(void) { return 0; }
uv_pid_t uv_os_getppid(void) { return 0; }
int uv_os_setenv(const char* name, const char* value) { return UV_ENOSYS; }
int uv_os_tmpdir(char* buffer, size_t* size) { return UV_ENOSYS; }
int uv_os_unsetenv(const char* name) { return UV_ENOSYS; }
int uv_pipe_bind2(uv_pipe_t* handle,
                            const char* name,
                            size_t namelen,
                            unsigned int flags) { return UV_ENOSYS; }
int uv_pipe_connect2(uv_connect_t* req,
                               uv_pipe_t* handle,
                               const char* name,
                               size_t namelen,
                               unsigned int flags,
                               uv_connect_cb cb) { return UV_ENOSYS; }
int uv_pipe_getpeername(const uv_pipe_t* handle,
                                  char* buffer,
                                  size_t* size) { return UV_ENOSYS; }
int uv_pipe_getsockname(const uv_pipe_t* handle,
                                  char* buffer,
                                  size_t* size) { return UV_ENOSYS; }
int uv_pipe_init(uv_loop_t*, uv_pipe_t* handle, int ipc) { return UV_ENOSYS; }
int uv_pipe_open(uv_pipe_t*, uv_file file) { return UV_ENOSYS; }
int uv_queue_work(uv_loop_t* loop,
                            uv_work_t* req,
                            uv_work_cb work_cb,
                            uv_after_work_cb after_work_cb) { return UV_ENOSYS; }
int uv_random(uv_loop_t* loop,
                        uv_random_t* req,
                        void *buf,
                        size_t buflen,
                        unsigned flags,  
                        uv_random_cb cb) { return UV_ENOSYS; }
int uv_signal_start(uv_signal_t* handle,
                              uv_signal_cb signal_cb,
                              int signum) { return UV_ENOSYS; }
int uv_tcp_bind(uv_tcp_t* handle,
                          const uv_sockaddr_t* addr,
                          unsigned int flags) { return UV_ENOSYS; }
int uv_tcp_connect(uv_connect_t* req,
                             uv_tcp_t* handle,
                             const uv_sockaddr_t* addr,
                             uv_connect_cb cb) { return UV_ENOSYS; }
int uv_tcp_getpeername(const uv_tcp_t* handle,
                                 uv_sockaddr_t* name,
                                 int* namelen) { return UV_ENOSYS; }
int uv_tcp_getsockname(const uv_tcp_t* handle,
                                 uv_sockaddr_t* name,
                                 int* namelen) { return UV_ENOSYS; }
int uv_tcp_init_ex(uv_loop_t*, uv_tcp_t* handle, unsigned int flags) { return UV_ENOSYS; }
int uv_tcp_keepalive(uv_tcp_t* handle,
                               int enable,
                               unsigned int delay) { return UV_ENOSYS; }
int uv_tcp_nodelay(uv_tcp_t* handle, int enable) { return UV_ENOSYS; }
int uv_thread_create(uv_thread_t* tid, uv_thread_cb entry, void* arg) { return UV_ENOSYS; }
int uv_thread_join(uv_thread_t *tid) { return UV_ENOSYS; }
int uv_uptime(double* uptime) { return UV_ENOSYS; }

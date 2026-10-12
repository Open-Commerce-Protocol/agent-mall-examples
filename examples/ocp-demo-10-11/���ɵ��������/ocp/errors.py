class OCPError(Exception):
    def __init__(self, code, message, status=400, details=None):
        super(OCPError, self).__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


class NotFoundError(OCPError):
    def __init__(self, resource, resource_id):
        super(NotFoundError, self).__init__(
            "resource_not_found",
            "%s %s was not found" % (resource, resource_id),
            status=404,
            details={"resource": resource, "id": resource_id},
        )


class ConflictError(OCPError):
    def __init__(self, code, message, details=None):
        super(ConflictError, self).__init__(code, message, status=409, details=details)

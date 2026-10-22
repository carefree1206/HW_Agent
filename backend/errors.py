class DomainError(Exception):
    def __init__(self, code, message, status=409, context=None):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status
        self.context = context or {}
